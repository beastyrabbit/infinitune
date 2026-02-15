import { formatTime } from "@infinitune/shared/format-time";
import {
	CreateRoomRequestSchema,
	type NowPlayingResponse,
} from "@infinitune/shared/protocol";
import { Hono } from "hono";
import type { RoomManager } from "../room/room-manager";

/**
 * Create room REST routes. The RoomManager instance is injected because it
 * is shared with the WebSocket handler and event sync.
 */
export function createRoomRoutes(roomManager: RoomManager): Hono {
	const app = new Hono();

	// GET /rooms — list active rooms
	app.get("/rooms", (c) => {
		return c.json(roomManager.listRooms());
	});

	// POST /rooms — create a new room
	app.post("/rooms", async (c) => {
		const body = await c.req.json();
		const result = CreateRoomRequestSchema.safeParse(body);
		if (!result.success) {
			return c.json({ error: result.error.message }, 400);
		}
		const { id, name, playlistKey } = result.data;
		roomManager.createRoom(id, name, playlistKey);
		return c.json({ id, name, playlistKey }, 201);
	});

	// DELETE /rooms/:id — delete a room
	app.delete("/rooms/:id", (c) => {
		const roomId = c.req.param("id");
		if (!roomManager.getRoom(roomId)) {
			return c.json({ error: `Room "${roomId}" not found` }, 404);
		}
		roomManager.removeRoom(roomId);
		return c.json({ deleted: roomId });
	});

	// GET /now-playing?room=<id> — get now-playing info (Waybar compatible)
	app.get("/now-playing", (c) => {
		const roomId = c.req.query("room");
		if (!roomId) {
			return c.json({ error: "Missing ?room= parameter" }, 400);
		}

		const room = roomManager.getRoom(roomId);
		if (!room) {
			// Return empty for Waybar (no crash)
			return c.json({ text: "", tooltip: "", class: "stopped" });
		}

		const song = room.getCurrentSong();
		const pb = room.playback;

		const text = song?.title
			? `♪ ${song.title} - ${song.artistName ?? "Unknown"}`
			: "";

		const tooltip = song?.title
			? [
					song.title,
					`by ${song.artistName ?? "Unknown"}`,
					`${formatTime(pb.currentTime)} / ${formatTime(pb.duration)}`,
					`Room: ${room.name}`,
					`Devices: ${room.getDeviceCount()}`,
				].join("\n")
			: "No song playing";

		const response: NowPlayingResponse = {
			text,
			tooltip,
			class: pb.isPlaying ? "playing" : "paused",
			song: song ?? null,
			playback: { ...pb },
			room: {
				id: room.id,
				name: room.name,
				deviceCount: room.getDeviceCount(),
			},
		};
		return c.json(response);
	});

	return app;
}
