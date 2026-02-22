import {
	AuthSessionSchema,
	DeviceRecordSchema,
	DeviceRegisterRequestSchema,
	DeviceRegisterResponseSchema,
	IssueDeviceTokenRequestSchema,
	IssueDeviceTokenResponseSchema,
	PlaylistCommandRequestSchema,
	PlaylistDeviceAssignmentSchema,
	PlaylistDeviceAssignmentsResponseSchema,
	PlaylistSessionInfoSchema,
} from "@infinitune/shared/protocol";
import { Hono } from "hono";
import z from "zod";
import { getRequestActor, requireUserActor } from "../auth/actor";
import { syncRoom } from "../room/room-event-handler";
import type { RoomManager } from "../room/room-manager";
import * as deviceService from "../services/device-service";
import * as playlistService from "../services/playlist-service";

const UpdateDeviceSchema = z.object({
	name: z.string().min(1).max(120).optional(),
});

function canAccessOwnedResource(
	ownerUserId: string | null,
	userId: string | undefined,
	deviceOwnerUserId: string | null | undefined,
): boolean {
	if (!ownerUserId) return true;
	if (userId && ownerUserId === userId) return true;
	if (deviceOwnerUserId && ownerUserId === deviceOwnerUserId) return true;
	return false;
}

async function ensurePlaylistSession(
	roomManager: RoomManager,
	playlistId: string,
) {
	const playlist = await playlistService.getById(playlistId);
	if (!playlist) return null;

	const room = roomManager.createRoom(
		playlist.id,
		playlist.name,
		playlist.playlistKey ?? playlist.id,
	);
	room.playlistId = playlist.id;
	await syncRoom(room);

	return { room, playlist };
}

async function ensurePlaylistPermission(
	roomManager: RoomManager,
	playlistId: string,
	userId: string,
) {
	const session = await ensurePlaylistSession(roomManager, playlistId);
	if (!session) return { error: "not_found" as const };

	if (session.playlist.ownerUserId && session.playlist.ownerUserId !== userId) {
		return { error: "forbidden" as const };
	}

	return { session };
}

export function createControlRoutes(roomManager: RoomManager): Hono {
	const app = new Hono();

	app.get("/auth/session", async (c) => {
		const actor = await getRequestActor(c);
		const payload =
			actor.kind === "user"
				? {
						authenticated: true,
						userId: actor.userId,
						email: actor.email ?? null,
						name: actor.name ?? null,
						picture: actor.picture ?? null,
					}
				: {
						authenticated: false,
						userId: null,
						email: null,
						name: null,
						picture: null,
					};
		return c.json(AuthSessionSchema.parse(payload));
	});

	app.get("/playlists/:playlistId/session", async (c) => {
		const playlistId = c.req.param("playlistId");
		const session = await ensurePlaylistSession(roomManager, playlistId);
		if (!session) return c.json({ error: "Playlist not found" }, 404);

		const actor = await requireUserActor(c);
		const deviceToken = c.req.header("x-device-token");
		const deviceActor = deviceToken
			? await deviceService.authenticateDeviceToken(deviceToken)
			: null;
		if (
			!canAccessOwnedResource(
				session.playlist.ownerUserId,
				actor?.userId,
				deviceActor?.ownerUserId,
			)
		) {
			return c.json({ error: "Forbidden" }, 403);
		}

		return c.json(
			PlaylistSessionInfoSchema.parse({
				playlistId: session.playlist.id,
				playlistKey: session.playlist.playlistKey ?? null,
				playlistName: session.playlist.name,
				playback: session.room.playback,
				currentSong: session.room.getCurrentSong(),
				devices: session.room.getDevices(),
				queue: session.room.getQueue(),
			}),
		);
	});

	app.post("/commands", async (c) => {
		const body = await c.req.json();
		const parsed = PlaylistCommandRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.message }, 400);
		}

		const userActor = await requireUserActor(c);
		const deviceToken = c.req.header("x-device-token");
		const deviceActor = deviceToken
			? await deviceService.authenticateDeviceToken(deviceToken)
			: null;
		if (!userActor && !deviceActor) {
			return c.json(
				{ error: "Unauthorized: requires Shoo user token or x-device-token" },
				401,
			);
		}

		const session = await ensurePlaylistSession(
			roomManager,
			parsed.data.playlistId,
		);
		if (!session) {
			return c.json({ error: "Playlist not found" }, 404);
		}
		if (
			!canAccessOwnedResource(
				session.playlist.ownerUserId,
				userActor?.userId,
				deviceActor?.ownerUserId,
			)
		) {
			return c.json({ error: "Forbidden" }, 403);
		}

		session.room.handleCommand(
			userActor?.userId ?? deviceActor?.id ?? "api",
			parsed.data.action,
			parsed.data.payload,
			parsed.data.targetDeviceId,
		);

		return c.json({ ok: true });
	});

	app.get("/devices", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);
		const devices = await deviceService.listDevicesByOwner(actor.userId);
		return c.json(z.array(DeviceRecordSchema).parse(devices));
	});

	app.get("/devices/assignments", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);
		const assignments = await deviceService.listActiveAssignmentsByOwner(
			actor.userId,
		);
		return c.json(
			z.array(PlaylistDeviceAssignmentSchema).parse(
				assignments.map((assignment) => ({
					playlistId: assignment.playlistId,
					deviceId: assignment.deviceId,
					isActive: assignment.isActive,
					assignedAt: assignment.assignedAt,
				})),
			),
		);
	});

	app.post("/devices", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const body = await c.req.json();
		const parsed = IssueDeviceTokenRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.message }, 400);
		}

		const issued = await deviceService.issueDeviceToken(
			actor.userId,
			parsed.data.name,
		);
		return c.json(
			IssueDeviceTokenResponseSchema.parse({
				device: issued.device,
				token: issued.token,
			}),
			201,
		);
	});

	app.patch("/devices/:deviceId", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const body = await c.req.json();
		const parsed = UpdateDeviceSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.message }, 400);
		}

		const existing = await deviceService.getDeviceById(c.req.param("deviceId"));
		if (!existing) return c.json({ error: "Device not found" }, 404);
		if (existing.ownerUserId && existing.ownerUserId !== actor.userId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const updated = await deviceService.touchDevice(existing.id, {
			name: parsed.data.name,
		});
		if (!updated) return c.json({ error: "Device not found" }, 404);
		return c.json(DeviceRecordSchema.parse(updated));
	});

	app.post("/devices/:deviceId/revoke-token", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const existing = await deviceService.getDeviceById(c.req.param("deviceId"));
		if (!existing) return c.json({ error: "Device not found" }, 404);
		if (existing.ownerUserId && existing.ownerUserId !== actor.userId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const updated = await deviceService.revokeDeviceToken(existing.id);
		if (!updated) return c.json({ error: "Device not found" }, 404);
		return c.json(DeviceRecordSchema.parse(updated));
	});

	app.post("/devices/register", async (c) => {
		const token = c.req.header("x-device-token");
		if (!token) {
			return c.json({ error: "Missing x-device-token header" }, 401);
		}

		const authedDevice = await deviceService.authenticateDeviceToken(token);
		if (!authedDevice) {
			return c.json({ error: "Invalid or revoked device token" }, 401);
		}

		const body = await c.req.json().catch(() => ({}));
		const parsed = DeviceRegisterRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: parsed.error.message }, 400);
		}

		const updated = await deviceService.touchDevice(authedDevice.id, {
			name: parsed.data.name,
			daemonVersion: parsed.data.daemonVersion,
			capabilities: parsed.data.capabilities,
		});
		if (!updated) return c.json({ error: "Device not found" }, 404);

		const assignment = await deviceService.getActiveAssignmentByDeviceId(
			updated.id,
		);
		return c.json(
			DeviceRegisterResponseSchema.parse({
				device: updated,
				assignedPlaylistId: assignment?.playlistId ?? null,
			}),
		);
	});

	app.get("/playlists/:playlistId/devices", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const permission = await ensurePlaylistPermission(
			roomManager,
			c.req.param("playlistId"),
			actor.userId,
		);
		if ("error" in permission) {
			if (permission.error === "not_found") {
				return c.json({ error: "Playlist not found" }, 404);
			}
			return c.json({ error: "Forbidden" }, 403);
		}

		const assignments = await deviceService.listActiveAssignmentsByPlaylist(
			permission.session.playlist.id,
		);
		const assignmentPayload = z.array(PlaylistDeviceAssignmentSchema).parse(
			assignments.map((assignment) => ({
				playlistId: assignment.playlistId,
				deviceId: assignment.deviceId,
				isActive: assignment.isActive,
				assignedAt: assignment.assignedAt,
			})),
		);

		return c.json(
			PlaylistDeviceAssignmentsResponseSchema.parse({
				playlistId: permission.session.playlist.id,
				assignments: assignmentPayload,
				activeDevices: permission.session.room.getDevices(),
			}),
		);
	});

	app.post("/playlists/:playlistId/devices/:deviceId/assign", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const permission = await ensurePlaylistPermission(
			roomManager,
			c.req.param("playlistId"),
			actor.userId,
		);
		if ("error" in permission) {
			if (permission.error === "not_found") {
				return c.json({ error: "Playlist not found" }, 404);
			}
			return c.json({ error: "Forbidden" }, 403);
		}

		const device = await deviceService.getDeviceById(c.req.param("deviceId"));
		if (!device) return c.json({ error: "Device not found" }, 404);
		if (device.ownerUserId && device.ownerUserId !== actor.userId) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const assignment = await deviceService.assignDeviceToPlaylist(
			permission.session.playlist.id,
			device.id,
			actor.userId,
		);
		return c.json(
			PlaylistDeviceAssignmentSchema.parse({
				playlistId: assignment.playlistId,
				deviceId: assignment.deviceId,
				isActive: assignment.isActive,
				assignedAt: assignment.assignedAt,
			}),
		);
	});

	app.post("/playlists/:playlistId/devices/:deviceId/unassign", async (c) => {
		const actor = await requireUserActor(c);
		if (!actor) return c.json({ error: "Unauthorized" }, 401);

		const permission = await ensurePlaylistPermission(
			roomManager,
			c.req.param("playlistId"),
			actor.userId,
		);
		if ("error" in permission) {
			if (permission.error === "not_found") {
				return c.json({ error: "Playlist not found" }, 404);
			}
			return c.json({ error: "Forbidden" }, 403);
		}

		await deviceService.unassignDeviceFromPlaylist(
			permission.session.playlist.id,
			c.req.param("deviceId"),
		);
		return c.json({ ok: true });
	});

	return app;
}
