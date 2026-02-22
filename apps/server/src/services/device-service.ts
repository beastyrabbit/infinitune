import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import type { Device, PlaylistDeviceAssignment } from "../db/schema";
import { devices, playlistDeviceAssignments } from "../db/schema";
import { parseJsonField } from "../wire";

export type DeviceWithCapabilities = Omit<Device, "capabilities"> & {
	capabilities?: Record<string, unknown>;
};

function hashToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

function createDeviceToken(): string {
	return `infi_dev_${randomBytes(24).toString("base64url")}`;
}

function withCapabilities(device: Device): DeviceWithCapabilities {
	const { capabilities, ...rest } = device;
	return {
		...rest,
		capabilities:
			parseJsonField<Record<string, unknown>>(capabilities ?? null) ??
			undefined,
	};
}

export async function issueDeviceToken(
	ownerUserId: string,
	name: string,
): Promise<{ device: DeviceWithCapabilities; token: string }> {
	const token = createDeviceToken();
	const tokenHash = hashToken(token);
	const now = Date.now();

	const [row] = await db
		.insert(devices)
		.values({
			name,
			tokenHash,
			ownerUserId,
			status: "active",
			lastSeenAt: now,
		})
		.returning();

	return { device: withCapabilities(row), token };
}

export async function authenticateDeviceToken(
	token: string,
): Promise<DeviceWithCapabilities | null> {
	const tokenHash = hashToken(token);
	const [row] = await db
		.select()
		.from(devices)
		.where(and(eq(devices.tokenHash, tokenHash), eq(devices.status, "active")))
		.limit(1);

	return row ? withCapabilities(row) : null;
}

export async function touchDevice(
	deviceId: string,
	patch?: {
		name?: string;
		daemonVersion?: string;
		capabilities?: Record<string, unknown>;
	},
): Promise<DeviceWithCapabilities | null> {
	const nextPatch: Record<string, unknown> = {
		lastSeenAt: Date.now(),
	};
	if (patch?.name) nextPatch.name = patch.name;
	if (patch?.daemonVersion !== undefined) {
		nextPatch.daemonVersion = patch.daemonVersion;
	}
	if (patch?.capabilities !== undefined) {
		nextPatch.capabilities = JSON.stringify(patch.capabilities);
	}

	const [row] = await db
		.update(devices)
		.set(nextPatch)
		.where(eq(devices.id, deviceId))
		.returning();

	return row ? withCapabilities(row) : null;
}

export async function listDevicesByOwner(
	ownerUserId: string,
): Promise<DeviceWithCapabilities[]> {
	const rows = await db
		.select()
		.from(devices)
		.where(eq(devices.ownerUserId, ownerUserId))
		.orderBy(desc(devices.lastSeenAt), desc(devices.createdAt));
	return rows.map(withCapabilities);
}

export async function getDeviceById(
	deviceId: string,
): Promise<DeviceWithCapabilities | null> {
	const [row] = await db
		.select()
		.from(devices)
		.where(eq(devices.id, deviceId))
		.limit(1);
	return row ? withCapabilities(row) : null;
}

export async function revokeDeviceToken(
	deviceId: string,
): Promise<DeviceWithCapabilities | null> {
	const [row] = await db
		.update(devices)
		.set({
			status: "revoked",
			tokenHash: `revoked:${randomBytes(16).toString("hex")}`,
		})
		.where(eq(devices.id, deviceId))
		.returning();
	return row ? withCapabilities(row) : null;
}

export async function assignDeviceToPlaylist(
	playlistId: string,
	deviceId: string,
	assignedByUserId: string,
): Promise<PlaylistDeviceAssignment> {
	// A device belongs to at most one active playlist assignment at a time.
	await db
		.update(playlistDeviceAssignments)
		.set({ isActive: false })
		.where(
			and(
				eq(playlistDeviceAssignments.deviceId, deviceId),
				eq(playlistDeviceAssignments.isActive, true),
			),
		);

	const [row] = await db
		.insert(playlistDeviceAssignments)
		.values({
			playlistId,
			deviceId,
			assignedByUserId,
			assignedAt: Date.now(),
			isActive: true,
		})
		.returning();

	return row;
}

export async function unassignDeviceFromPlaylist(
	playlistId: string,
	deviceId: string,
): Promise<void> {
	await db
		.update(playlistDeviceAssignments)
		.set({ isActive: false })
		.where(
			and(
				eq(playlistDeviceAssignments.playlistId, playlistId),
				eq(playlistDeviceAssignments.deviceId, deviceId),
				eq(playlistDeviceAssignments.isActive, true),
			),
		);
}

export async function getActiveAssignmentByDeviceId(
	deviceId: string,
): Promise<PlaylistDeviceAssignment | null> {
	const [row] = await db
		.select()
		.from(playlistDeviceAssignments)
		.where(
			and(
				eq(playlistDeviceAssignments.deviceId, deviceId),
				eq(playlistDeviceAssignments.isActive, true),
			),
		)
		.orderBy(desc(playlistDeviceAssignments.assignedAt))
		.limit(1);
	return row ?? null;
}

export async function listActiveAssignmentsByPlaylist(
	playlistId: string,
): Promise<PlaylistDeviceAssignment[]> {
	return db
		.select()
		.from(playlistDeviceAssignments)
		.where(
			and(
				eq(playlistDeviceAssignments.playlistId, playlistId),
				eq(playlistDeviceAssignments.isActive, true),
			),
		)
		.orderBy(desc(playlistDeviceAssignments.assignedAt));
}

export async function listActiveAssignmentsByOwner(
	ownerUserId: string,
): Promise<PlaylistDeviceAssignment[]> {
	const rows = await db
		.select({ assignment: playlistDeviceAssignments })
		.from(playlistDeviceAssignments)
		.innerJoin(devices, eq(playlistDeviceAssignments.deviceId, devices.id))
		.where(
			and(
				eq(playlistDeviceAssignments.isActive, true),
				eq(devices.ownerUserId, ownerUserId),
			),
		)
		.orderBy(desc(playlistDeviceAssignments.assignedAt));
	return rows.map((row) => row.assignment);
}
