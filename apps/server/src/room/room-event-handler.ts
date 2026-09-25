import type { SongData } from "@infinitune/shared/protocol";
import { on } from "../events/event-bus";
import { logger } from "../logger";
import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";
import type { SongWire } from "../wire";
import type { Room } from "./room";
import type { RoomManager } from "./room-manager";

const IDLE_ROOM_MANUAL_TOP_UP_COUNT = 5;

// ─── Wire → Protocol conversion ─────────────────────────────────────

/** Map a nullable wire field to an optional protocol field. */
function optional<T>(value: T | null | undefined): T | undefined {
	return value ?? undefined;
}

/** Convert a SongWire (DB wire format) to the lightweight SongData protocol type. */
function toSongData(s: SongWire): SongData {
	return {
		id: s.id,
		title: optional(s.title),
		artistName: optional(s.artistName),
		genre: optional(s.genre),
		subGenre: optional(s.subGenre),
		cover: optional(s.cover),
		audioUrl: optional(s.audioUrl),
		status: s.status,
		orderIndex: s.orderIndex,
		isInterrupt: optional(s.isInterrupt),
		promptEpoch: optional(s.promptEpoch),
		createdAt: s.createdAt,
		audioDuration: optional(s.audioDuration),
		mood: optional(s.mood),
		energy: optional(s.energy),
		era: optional(s.era),
		vocalStyle: optional(s.vocalStyle),
		userRating: optional(s.userRating as "up" | "down" | undefined),
		bpm: optional(s.bpm),
		keyScale: optional(s.keyScale),
		lyrics: optional(s.lyrics),
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

async function primePlaylistForIdleRoomStart(
	room: Room,
	playlistId: string,
	orderIndex: number,
	promptEpoch: number,
): Promise<void> {
	try {
		// Opening a room is an explicit "keep this playlist alive" signal.
		await playlistService.heartbeat(playlistId);
		await playlistService.updatePosition(playlistId, orderIndex);

		const workQueue = await songService.getWorkQueue(playlistId);
		const baseOrder = Math.ceil(workQueue.maxOrderIndex);

		await Promise.all(
			Array.from({ length: IDLE_ROOM_MANUAL_TOP_UP_COUNT }, (_, i) =>
				songService.createPending(playlistId, baseOrder + i + 1, {
					promptEpoch,
				}),
			),
		);

		logger.info(
			{
				roomId: room.id,
				playlistId,
				orderIndex,
				addedSongs: IDLE_ROOM_MANUAL_TOP_UP_COUNT,
			},
			"Primed idle room playback and queued additional songs",
		);
	} catch (err) {
		logger.error(
			{ err, roomId: room.id, playlistId, orderIndex },
			"Failed to prime idle room playback",
		);
	}
}

// ─── Room sync (playlist key → ID resolution) ───────────────────────

/** Resolve a room's playlist key to an ID and sync its queue. */
export async function syncRoom(room: Room): Promise<void> {
	try {
		// Always re-resolve by playlist key to avoid stale room.playlistId linkage.
		const byKey = await playlistService.getByKey(room.playlistKey);
		if (byKey) {
			room.playlistId = byKey.id;
			const songs = await songService.listByPlaylist(byKey.id);
			const updateResult = room.updateQueue(
				songs.map(toSongData),
				byKey.promptEpoch ?? 0,
			);
			if (
				updateResult.seededFromIdle &&
				typeof updateResult.seededSongOrderIndex === "number"
			) {
				await primePlaylistForIdleRoomStart(
					room,
					byKey.id,
					updateResult.seededSongOrderIndex,
					byKey.promptEpoch ?? 0,
				);
			}
			return;
		}

		// Fallback for legacy rooms that still have an ID but key lookup fails.
		if (room.playlistId) {
			const playlist = await playlistService.getById(room.playlistId);
			const songs = await songService.listByPlaylist(room.playlistId);
			const updateResult = room.updateQueue(
				songs.map(toSongData),
				playlist?.promptEpoch ?? 0,
			);
			if (
				updateResult.seededFromIdle &&
				typeof updateResult.seededSongOrderIndex === "number"
			) {
				await primePlaylistForIdleRoomStart(
					room,
					room.playlistId,
					updateResult.seededSongOrderIndex,
					playlist?.promptEpoch ?? 0,
				);
			}
			return;
		}

		// No playlist mapping available: clear queue state.
		room.updateQueue([], 0);
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

async function reportPlaylistPosition(
	playlistId: string,
	orderIndex: number,
): Promise<void> {
	try {
		await playlistService.updatePosition(playlistId, orderIndex);
	} catch (err) {
		logger.error(
			{ err, playlistId, orderIndex },
			"Failed to update playlist position from room",
		);
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
	roomManager.setPositionCallback(reportPlaylistPosition);

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
