import {
	type ClientMessage,
	ClientMessageSchema,
} from "@infinitune/shared/protocol";
import type { WebSocket } from "ws";
import { logger } from "../logger";
import type { Room } from "./room";
import { syncRoom } from "./room-event-handler";
import type { RoomManager } from "./room-manager";

// Track which room each WebSocket belongs to
const wsRoomMap = new Map<WebSocket, { roomId: string; deviceId: string }>();

/** Look up the room and device for a WebSocket connection. */
function getRoomContext(
	ws: WebSocket,
	roomManager: RoomManager,
): { room: Room; deviceId: string } | null {
	const mapping = wsRoomMap.get(ws);
	if (!mapping) return null;
	const room = roomManager.getRoom(mapping.roomId);
	if (!room) return null;
	return { room, deviceId: mapping.deviceId };
}

function handleClientMessage(
	ws: WebSocket,
	msg: ClientMessage,
	roomManager: RoomManager,
): void {
	switch (msg.type) {
		case "join": {
			// Leave previous room if any
			const prev = wsRoomMap.get(ws);
			if (prev) {
				roomManager.leaveRoom(prev.roomId, prev.deviceId);
			}

			// Auto-create room if it doesn't exist and playlistKey is provided
			if (!roomManager.getRoom(msg.roomId) && msg.playlistKey) {
				const roomName = msg.roomName || msg.roomId;
				roomManager.createRoom(msg.roomId, roomName, msg.playlistKey);
				const newRoom = roomManager.getRoom(msg.roomId);
				if (newRoom) {
					syncRoom(newRoom);
				}
			}

			const room = roomManager.joinRoom(
				msg.roomId,
				msg.deviceId,
				msg.deviceName,
				msg.role,
				ws,
			);
			if (room) {
				wsRoomMap.set(ws, {
					roomId: msg.roomId,
					deviceId: msg.deviceId,
				});
				// Ensure queue/state is hydrated for both newly created and pre-existing rooms.
				// Without this, rooms created via REST can stay unsynced until another playlist/song event happens.
				void syncRoom(room);
			} else {
				ws.send(
					JSON.stringify({
						type: "error",
						message: `Room "${msg.roomId}" not found. Provide playlistKey to auto-create.`,
					}),
				);
			}
			break;
		}
		case "command": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx)
				ctx.room.handleCommand(
					ctx.deviceId,
					msg.action,
					msg.payload,
					msg.targetDeviceId,
				);
			break;
		}
		case "renameDevice": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx) ctx.room.renameDevice(msg.targetDeviceId, msg.name);
			break;
		}
		case "sync": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx)
				ctx.room.handleSync(
					ctx.deviceId,
					msg.currentSongId,
					msg.isPlaying,
					msg.currentTime,
					msg.duration,
				);
			break;
		}
		case "setRole": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx) ctx.room.setDeviceRole(ctx.deviceId, msg.role);
			break;
		}
		case "songEnded": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx) ctx.room.handleSongEnded();
			break;
		}
		case "ping": {
			const ctx = getRoomContext(ws, roomManager);
			if (ctx) ctx.room.handlePing(ctx.deviceId, msg.clientTime);
			break;
		}
	}
}

/**
 * Handle a new WebSocket connection on the room path.
 * Called by the unified server for connections to `/ws/room`.
 */
export function handleRoomConnection(
	ws: WebSocket,
	roomManager: RoomManager,
): void {
	ws.on("message", (raw) => {
		let data: unknown;
		try {
			data = JSON.parse(raw.toString());
		} catch {
			ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
			return;
		}

		const parsed = ClientMessageSchema.safeParse(data);
		if (!parsed.success) {
			ws.send(
				JSON.stringify({
					type: "error",
					message: `Invalid message: ${parsed.error.message}`,
				}),
			);
			return;
		}

		handleClientMessage(ws, parsed.data, roomManager);
	});

	ws.on("close", () => {
		const mapping = wsRoomMap.get(ws);
		if (mapping) {
			roomManager.leaveRoom(mapping.roomId, mapping.deviceId);
			wsRoomMap.delete(ws);
		}
	});

	ws.on("error", (err) => {
		logger.error({ err }, "Room WebSocket connection error");
	});
}
