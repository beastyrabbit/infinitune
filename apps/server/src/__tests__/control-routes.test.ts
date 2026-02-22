import {
	HouseCommandResponseSchema,
	HouseSessionsResponseSchema,
} from "@infinitune/shared/protocol";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/actor", () => ({
	getRequestActor: vi.fn(),
	requireUserActor: vi.fn(),
}));

vi.mock("../services/device-service", () => ({
	authenticateDeviceToken: vi.fn(),
}));

vi.mock("../services/playlist-service", () => ({
	getById: vi.fn(),
}));

vi.mock("../room/room-event-handler", () => ({
	syncRoom: vi.fn().mockResolvedValue(undefined),
}));

import * as authActor from "../auth/actor";
import { RoomManager } from "../room/room-manager";
import { createControlRoutes } from "../routes/control";
import * as deviceService from "../services/device-service";
import * as playlistService from "../services/playlist-service";

function makePlaylist(id: string, ownerUserId: string | null) {
	return {
		id,
		name: `Playlist ${id}`,
		playlistKey: id,
		ownerUserId,
	} as never;
}

function createApp(roomManager: RoomManager): Hono {
	const app = new Hono();
	app.route("/api/v1", createControlRoutes(roomManager));
	return app;
}

async function postHouseCommand(
	app: Hono,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
): Promise<Response> {
	return app.request("http://localhost/api/v1/house/commands", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(headers ?? {}),
		},
		body: JSON.stringify(body),
	});
}

describe("control routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(authActor.requireUserActor).mockResolvedValue(null);
		vi.mocked(deviceService.authenticateDeviceToken).mockResolvedValue(null);
		vi.mocked(playlistService.getById).mockResolvedValue(null);
	});

	it("returns 401 for house command when neither user nor device auth is present", async () => {
		const roomManager = new RoomManager();
		const app = createApp(roomManager);

		const response = await postHouseCommand(app, {
			action: "pause",
			playlistIds: ["pl-1"],
		});

		expect(response.status).toBe(401);
		expect(vi.mocked(playlistService.getById)).not.toHaveBeenCalled();
	});

	it("executes house command for accessible playlists and skips missing/forbidden ones", async () => {
		vi.mocked(authActor.requireUserActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		vi.mocked(playlistService.getById).mockImplementation(
			async (playlistId) => {
				if (playlistId === "pl-1") return makePlaylist("pl-1", "user-1");
				if (playlistId === "pl-2") return makePlaylist("pl-2", "user-2");
				return null;
			},
		);

		const roomManager = new RoomManager();
		const roomOne = roomManager.createRoom("pl-1", "Playlist One", "pl-1");
		const roomTwo = roomManager.createRoom("pl-2", "Playlist Two", "pl-2");
		const handleOne = vi.spyOn(roomOne, "handleCommand");
		const handleTwo = vi.spyOn(roomTwo, "handleCommand");
		const app = createApp(roomManager);

		const response = await postHouseCommand(app, {
			action: "pause",
			playlistIds: ["pl-1", "pl-2", "pl-3"],
		});

		expect(response.status).toBe(200);
		const payload = HouseCommandResponseSchema.parse(await response.json());
		expect(payload).toEqual({
			ok: true,
			affectedPlaylistIds: ["pl-1"],
			affectedRoomIds: ["pl-1"],
			skippedPlaylistIds: ["pl-2", "pl-3"],
		});
		expect(handleOne).toHaveBeenCalledWith(
			"user-1",
			"pause",
			undefined,
			undefined,
		);
		expect(handleTwo).not.toHaveBeenCalled();
	});

	it("accepts device-token auth and uses device actor as command initiator", async () => {
		vi.mocked(deviceService.authenticateDeviceToken).mockResolvedValue({
			id: "dev-1",
			ownerUserId: "user-1",
		} as never);
		vi.mocked(playlistService.getById).mockImplementation(
			async (playlistId) => {
				if (playlistId === "pl-1") return makePlaylist("pl-1", "user-1");
				return null;
			},
		);

		const roomManager = new RoomManager();
		const roomOne = roomManager.createRoom("pl-1", "Playlist One", "pl-1");
		const handleOne = vi.spyOn(roomOne, "handleCommand");
		const app = createApp(roomManager);

		const response = await postHouseCommand(
			app,
			{
				action: "stop",
				playlistIds: ["pl-1"],
			},
			{
				"x-device-token": "device-token-1",
			},
		);

		expect(response.status).toBe(200);
		const payload = HouseCommandResponseSchema.parse(await response.json());
		expect(payload.affectedPlaylistIds).toEqual(["pl-1"]);
		expect(payload.skippedPlaylistIds).toEqual([]);
		expect(
			vi.mocked(deviceService.authenticateDeviceToken),
		).toHaveBeenCalledWith("device-token-1");
		expect(handleOne).toHaveBeenCalledWith(
			"dev-1",
			"stop",
			undefined,
			undefined,
		);
	});

	it("reuses an existing room already mapped to the target playlist", async () => {
		vi.mocked(authActor.requireUserActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		vi.mocked(playlistService.getById).mockImplementation(
			async (playlistId) => {
				if (playlistId === "pl-1") return makePlaylist("pl-1", "user-1");
				return null;
			},
		);

		const roomManager = new RoomManager();
		const legacyRoom = roomManager.createRoom(
			"legacy-room-1",
			"Legacy Room",
			"legacy-key",
		);
		legacyRoom.playlistId = "pl-1";
		const handleLegacy = vi.spyOn(legacyRoom, "handleCommand");
		const app = createApp(roomManager);

		const response = await postHouseCommand(app, {
			action: "pause",
			playlistIds: ["pl-1"],
		});

		expect(response.status).toBe(200);
		const payload = HouseCommandResponseSchema.parse(await response.json());
		expect(payload.affectedRoomIds).toEqual(["legacy-room-1"]);
		expect(handleLegacy).toHaveBeenCalledWith(
			"user-1",
			"pause",
			undefined,
			undefined,
		);
		expect(roomManager.getRoom("pl-1")).toBeUndefined();
	});

	it("returns only accessible sessions for house snapshot endpoint", async () => {
		vi.mocked(authActor.requireUserActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		vi.mocked(playlistService.getById).mockImplementation(
			async (playlistId) => {
				if (playlistId === "pl-1") return makePlaylist("pl-1", "user-1");
				if (playlistId === "pl-2") return makePlaylist("pl-2", "user-2");
				return null;
			},
		);

		const roomManager = new RoomManager();
		const roomOne = roomManager.createRoom("pl-1", "Playlist One", "pl-1");
		roomOne.playlistId = "pl-1";
		const roomTwo = roomManager.createRoom("pl-2", "Playlist Two", "pl-2");
		roomTwo.playlistId = "pl-2";
		const app = createApp(roomManager);

		const response = await app.request(
			"http://localhost/api/v1/house/sessions",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		const payload = HouseSessionsResponseSchema.parse(await response.json());
		expect(payload.sessions).toHaveLength(1);
		expect(payload.sessions[0]?.playlistId).toBe("pl-1");
		expect(payload.sessions[0]?.roomId).toBe("pl-1");
	});
});
