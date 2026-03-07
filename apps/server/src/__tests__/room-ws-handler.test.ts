import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

vi.mock("../room/room-event-handler", () => ({
	syncRoom: vi.fn().mockResolvedValue(undefined),
}));

import { syncRoom } from "../room/room-event-handler";
import { RoomManager } from "../room/room-manager";
import { handleRoomConnection } from "../room/room-ws-handler";

type SocketHandler = (...args: unknown[]) => void;

function createMockSocket(): {
	ws: WebSocket;
	emit: (event: string, ...args: unknown[]) => void;
} {
	const handlers = new Map<string, SocketHandler[]>();
	const ws = {
		readyState: 1,
		send: vi.fn((_data: unknown, callback?: () => void) => {
			callback?.();
		}),
		close: vi.fn(),
		on: vi.fn((event: string, handler: SocketHandler) => {
			const existing = handlers.get(event) ?? [];
			existing.push(handler);
			handlers.set(event, existing);
		}),
	} as unknown as WebSocket;

	return {
		ws,
		emit: (event, ...args) => {
			for (const handler of handlers.get(event) ?? []) {
				handler(...args);
			}
		},
	};
}

describe("room ws handler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("sets playlistId before syncing when auto-creating a room on join", () => {
		const roomManager = new RoomManager();
		const socket = createMockSocket();

		handleRoomConnection(socket.ws, roomManager);
		socket.emit(
			"message",
			Buffer.from(
				JSON.stringify({
					type: "join",
					playlistId: "pl-123",
					deviceId: "device-1",
					deviceName: "Living Room",
					role: "player",
					playlistKey: "key-123",
				}),
			),
		);

		expect(vi.mocked(syncRoom)).toHaveBeenCalled();
		const firstSyncedRoom = vi.mocked(syncRoom).mock.calls[0]?.[0];
		expect(firstSyncedRoom?.playlistId).toBe("pl-123");
		expect(roomManager.getRoom("pl-123")?.playlistId).toBe("pl-123");
	});

	it("hydrates an existing room on join even without auto-create", () => {
		const roomManager = new RoomManager();
		roomManager.createRoom("pl-123", "Playlist One", "key-123");
		const socket = createMockSocket();

		handleRoomConnection(socket.ws, roomManager);
		socket.emit(
			"message",
			Buffer.from(
				JSON.stringify({
					type: "join",
					playlistId: "pl-123",
					deviceId: "device-1",
					deviceName: "Living Room",
					role: "player",
				}),
			),
		);

		expect(vi.mocked(syncRoom)).toHaveBeenCalledWith(
			expect.objectContaining({ id: "pl-123" }),
		);
	});

	it("rejects join requests with a mismatched protocol version", () => {
		const roomManager = new RoomManager();
		const socket = createMockSocket();

		handleRoomConnection(socket.ws, roomManager);
		socket.emit(
			"message",
			Buffer.from(
				JSON.stringify({
					type: "join",
					playlistId: "pl-123",
					deviceId: "device-1",
					deviceName: "Living Room",
					role: "player",
					playlistKey: "key-123",
					protocolVersion: 1,
				}),
			),
		);

		expect(socket.ws.send).toHaveBeenCalledWith(
			expect.stringContaining("Refresh this page and reconnect."),
			expect.any(Function),
		);
		expect(socket.ws.close).toHaveBeenCalledWith(
			1008,
			"Protocol version mismatch",
		);
		expect(roomManager.getRoom("pl-123")).toBeUndefined();
	});
});
