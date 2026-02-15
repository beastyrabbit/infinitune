import type { DeviceRole, RoomInfo } from "@infinitune/shared/protocol";
import type { WebSocket } from "ws";
import { logger } from "../logger";
import { Room } from "./room";

export class RoomManager {
	private rooms = new Map<string, Room>();
	private markPlayedCallback: ((songId: string) => Promise<void>) | null = null;

	setMarkPlayedCallback(cb: (songId: string) => Promise<void>): void {
		this.markPlayedCallback = cb;
	}

	createRoom(id: string, name: string, playlistKey: string): Room {
		if (this.rooms.has(id)) {
			return this.rooms.get(id)!;
		}
		const room = new Room(
			id,
			name,
			playlistKey,
			this.markPlayedCallback ?? undefined,
		);
		this.rooms.set(id, room);
		logger.info({ roomId: id, name, playlistKey }, "Room created");
		return room;
	}

	getRoom(id: string): Room | undefined {
		return this.rooms.get(id);
	}

	removeRoom(id: string): void {
		const room = this.rooms.get(id);
		if (room) room.dispose();
		this.rooms.delete(id);
		logger.info({ roomId: id }, "Room removed");
	}

	listRooms(): RoomInfo[] {
		return Array.from(this.rooms.values()).map((room) => ({
			id: room.id,
			name: room.name,
			playlistKey: room.playlistKey,
			playlistId: room.playlistId,
			deviceCount: room.getDeviceCount(),
			playback: { ...room.playback },
			currentSong: room.getCurrentSong(),
		}));
	}

	joinRoom(
		roomId: string,
		deviceId: string,
		deviceName: string,
		role: DeviceRole,
		ws: WebSocket,
	): Room | null {
		const room = this.rooms.get(roomId);
		if (!room) return null;
		room.addDevice({ id: deviceId, name: deviceName, role }, ws);
		logger.info({ roomId, deviceId, deviceName, role }, "Device joined room");
		return room;
	}

	leaveRoom(roomId: string, deviceId: string): void {
		const room = this.rooms.get(roomId);
		if (!room) return;
		room.removeDevice(deviceId);
		logger.info({ roomId, deviceId }, "Device left room");
	}

	/** Get all rooms grouped by playlist key. */
	getRoomsByPlaylistKey(): Map<string, Room[]> {
		const byKey = new Map<string, Room[]>();
		for (const room of this.rooms.values()) {
			const existing = byKey.get(room.playlistKey) ?? [];
			existing.push(room);
			byKey.set(room.playlistKey, existing);
		}
		return byKey;
	}

	/** Get all rooms that have a given playlist ID. */
	getRoomsByPlaylistId(playlistId: string): Room[] {
		const rooms: Room[] = [];
		for (const room of this.rooms.values()) {
			if (room.playlistId === playlistId) {
				rooms.push(room);
			}
		}
		return rooms;
	}

	getAllRooms(): Room[] {
		return Array.from(this.rooms.values());
	}
}
