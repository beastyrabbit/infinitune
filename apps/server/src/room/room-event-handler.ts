import type { SongData } from "@infinitune/shared/protocol";
import { on } from "../events/event-bus";
import { logger } from "../logger";
import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";
import type { SongWire } from "../wire";
import type { Room } from "./room";
import type { RoomManager } from "./room-manager";

// ─── Wire → Protocol conversion ─────────────────────────────────────

/** Convert a SongWire (DB wire format) to the lightweight SongData protocol type. */
function toSongData(s: SongWire): SongData {
	return {
		_id: s._id,
		title: s.title ?? undefined,
		artistName: s.artistName ?? undefined,
		genre: s.genre ?? undefined,
		subGenre: s.subGenre ?? undefined,
		coverUrl: s.coverUrl ?? undefined,
		audioUrl: s.audioUrl ?? undefined,
		status: s.status,
		orderIndex: s.orderIndex,
		isInterrupt: s.isInterrupt ?? undefined,
		promptEpoch: s.promptEpoch ?? undefined,
		_creationTime: s._creationTime,
		audioDuration: s.audioDuration ?? undefined,
		mood: s.mood ?? undefined,
		energy: s.energy ?? undefined,
		era: s.era ?? undefined,
		vocalStyle: s.vocalStyle ?? undefined,
		userRating: (s.userRating as "up" | "down" | undefined) ?? undefined,
		bpm: s.bpm ?? undefined,
		keyScale: s.keyScale ?? undefined,
		lyrics: s.lyrics ?? undefined,
	};
}

// ─── Queue refresh ───────────────────────────────────────────────────

/** Fetch songs + playlist epoch from DB and push to rooms. */
async function refreshRooms(playlistId: string, rooms: Room[]): Promise<void> {
	if (rooms.length === 0) return;

	const playlist = await playlistService.getById(playlistId);
	const epoch = playlist?.promptEpoch ?? 0;

	const songs = await songService.listByPlaylist(playlistId);
	const songData = songs.map(toSongData);

	for (const room of rooms) {
		room.updateQueue(songData, epoch);
	}
}

// ─── Room sync (playlist key → ID resolution) ───────────────────────

/** Resolve a room's playlist key to an ID and sync its queue. */
export async function syncRoom(room: Room): Promise<void> {
	try {
		if (!room.playlistId) {
			const playlist = await playlistService.getByKey(room.playlistKey);
			if (!playlist) return;
			room.playlistId = playlist._id;
		}
		await refreshRooms(room.playlistId, [room]);
	} catch (err) {
		logger.error({ err, roomId: room.id }, "Failed to sync room");
	}
}

/** Mark a song as "played" via the service layer (used as Room callback). */
async function markSongPlayed(songId: string): Promise<void> {
	try {
		await songService.updateStatus(songId, "played");
	} catch (err) {
		logger.error({ err, songId }, "Failed to mark song as played");
	}
}

// ─── Event handler registration ──────────────────────────────────────

/**
 * Register event bus listeners that keep room queues in sync.
 * Replaces the old RabbitMQ-based EventSync.
 */
export function startRoomEventSync(roomManager: RoomManager): void {
	// Wire up the "mark played" callback so rooms can mark songs played
	roomManager.setMarkPlayedCallback(markSongPlayed);

	// Song events → refresh rooms that show the affected playlist
	const handleSongEvent = async (data: { playlistId: string }) => {
		const rooms = roomManager.getRoomsByPlaylistId(data.playlistId);
		if (rooms.length > 0) {
			await refreshRooms(data.playlistId, rooms);
		}
	};

	on("song.created", handleSongEvent);
	on("song.status_changed", handleSongEvent);
	on("song.deleted", handleSongEvent);
	on("song.metadata_updated", handleSongEvent);
	on("song.reordered", handleSongEvent);

	// Playlist steered → epoch changed, refresh rooms
	on("playlist.steered", async (data) => {
		const rooms = roomManager.getRoomsByPlaylistId(data.playlistId);
		if (rooms.length > 0) {
			await refreshRooms(data.playlistId, rooms);
		}
	});

	// Playlist deleted → clean up rooms for that playlist
	on("playlist.deleted", (data) => {
		const rooms = roomManager.getRoomsByPlaylistId(data.playlistId);
		for (const room of rooms) {
			room.updateQueue([], 0);
		}
	});

	logger.info("Room event sync registered");
}
