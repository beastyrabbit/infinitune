import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { getConvexClient } from "./convex-client.js";
import { ConvexSync } from "./convex-sync.js";
import {
	ClientMessageSchema,
	CreateRoomRequestSchema,
	type NowPlayingResponse,
	type RoomInfo,
} from "./protocol.js";
import { generateOpenApiSpec } from "./openapi.js";
import { RoomManager } from "./room-manager.js";

const PORT = Number(process.env.ROOM_SERVER_PORT ?? 5174);
const roomManager = new RoomManager();
const convexClient = getConvexClient();
const convexSync = new ConvexSync(convexClient, roomManager);

// Wire up the "mark played" callback
roomManager.setMarkPlayedCallback((songId) => convexSync.markSongPlayed(songId));

// Track which room each WebSocket belongs to
const wsRoomMap = new Map<WebSocket, { roomId: string; deviceId: string }>();

// ─── HTTP Server ────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function jsonResponse(data: unknown, status = 200): { body: string; status: number; headers: Record<string, string> } {
	return {
		body: JSON.stringify(data),
		status,
		headers: { "Content-Type": "application/json", ...corsHeaders() },
	};
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ error: message }, status);
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	// CORS preflight
	if (req.method === "OPTIONS") {
		const h = corsHeaders();
		res.writeHead(204, h);
		res.end();
		return;
	}

	let response: { body: string; status: number; headers: Record<string, string> };

	try {
		if (req.method === "GET" && url.pathname === "/api/v1/rooms") {
			response = handleListRooms();
		} else if (req.method === "POST" && url.pathname === "/api/v1/rooms") {
			const body = await readBody(req);
			response = handleCreateRoom(body);
		} else if (req.method === "GET" && url.pathname === "/api/v1/now-playing") {
			const roomId = url.searchParams.get("room");
			response = handleNowPlaying(roomId);
		} else if (req.method === "GET" && url.pathname === "/api/v1/openapi.json") {
			response = jsonResponse(generateOpenApiSpec());
		} else if (req.method === "DELETE" && url.pathname.startsWith("/api/v1/rooms/")) {
			const roomId = url.pathname.slice("/api/v1/rooms/".length);
			response = handleDeleteRoom(roomId);
		} else if (req.method === "GET" && url.pathname === "/health") {
			response = jsonResponse({ status: "ok", rooms: roomManager.listRooms().length });
		} else {
			response = errorResponse("Not found", 404);
		}
	} catch (err) {
		console.error("[http] Handler error:", err);
		response = errorResponse("Internal server error", 500);
	}

	res.writeHead(response.status, response.headers);
	res.end(response.body);
});

function handleListRooms(): ReturnType<typeof jsonResponse> {
	const rooms: RoomInfo[] = roomManager.listRooms();
	return jsonResponse(rooms);
}

function handleCreateRoom(body: string): ReturnType<typeof jsonResponse> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return errorResponse("Invalid JSON");
	}
	const result = CreateRoomRequestSchema.safeParse(parsed);
	if (!result.success) {
		return errorResponse(result.error.message);
	}
	const { id, name, playlistKey } = result.data;
	roomManager.createRoom(id, name, playlistKey);
	return jsonResponse({ id, name, playlistKey }, 201);
}

function handleDeleteRoom(roomId: string): ReturnType<typeof jsonResponse> {
	if (!roomManager.getRoom(roomId)) {
		return errorResponse(`Room "${roomId}" not found`, 404);
	}
	roomManager.removeRoom(roomId);
	return jsonResponse({ deleted: roomId });
}

function handleNowPlaying(roomId: string | null): ReturnType<typeof jsonResponse> {
	if (!roomId) {
		return errorResponse("Missing ?room= parameter");
	}
	const room = roomManager.getRoom(roomId);
	if (!room) {
		// Return empty for Waybar (no crash)
		return jsonResponse({ text: "", tooltip: "", class: "stopped" });
	}

	const song = room.getCurrentSong();
	const pb = room.playback;

	const formatTime = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, "0")}`;
	};

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
	return jsonResponse(response);
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString()));
		req.on("error", reject);
	});
}

// ─── WebSocket Server ───────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
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

		handleClientMessage(ws, parsed.data);
	});

	ws.on("close", () => {
		const mapping = wsRoomMap.get(ws);
		if (mapping) {
			roomManager.leaveRoom(mapping.roomId, mapping.deviceId);
			wsRoomMap.delete(ws);
		}
	});

	ws.on("error", (err) => {
		console.error("[ws] Connection error:", err.message);
	});
});

function handleClientMessage(ws: WebSocket, msg: import("./protocol.js").ClientMessage): void {
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
				convexSync.syncRoom(roomManager.getRoom(msg.roomId)!);
			}

			const room = roomManager.joinRoom(
				msg.roomId,
				msg.deviceId,
				msg.deviceName,
				msg.role,
				ws,
			);
			if (room) {
				wsRoomMap.set(ws, { roomId: msg.roomId, deviceId: msg.deviceId });
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
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.handleCommand(mapping.deviceId, msg.action, msg.payload, msg.targetDeviceId);
			break;
		}
		case "renameDevice": {
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.renameDevice(msg.targetDeviceId, msg.name);
			break;
		}
		case "sync": {
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.handleSync(
				mapping.deviceId,
				msg.currentSongId,
				msg.isPlaying,
				msg.currentTime,
				msg.duration,
			);
			break;
		}
		case "setRole": {
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.setDeviceRole(mapping.deviceId, msg.role);
			break;
		}
		case "songEnded": {
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.handleSongEnded();
			break;
		}
		case "ping": {
			const mapping = wsRoomMap.get(ws);
			if (!mapping) return;
			const room = roomManager.getRoom(mapping.roomId);
			room?.handlePing(mapping.deviceId, msg.clientTime);
			break;
		}
	}
}

// ─── Periodic time sync ─────────────────────────────────────────────
// Room-level pong broadcasts for clock calibration happen via Room.handlePing.
// Clients re-ping every 30s on their own to keep offset accurate.

// ─── Start ──────────────────────────────────────────────────────────

convexSync.start();

server.listen(PORT, () => {
	console.log(`[room-server] Listening on :${PORT}`);
	console.log(`[room-server] REST:  http://localhost:${PORT}/api/v1/rooms`);
	console.log(`[room-server] WS:    ws://localhost:${PORT}`);
});
