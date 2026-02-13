import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import type { SongData } from "./protocol.js";
import type { RoomManager } from "./room-manager.js";

const POLL_INTERVAL = 2000;

export class ConvexSync {
	private client: ConvexHttpClient;
	private roomManager: RoomManager;
	private timer: ReturnType<typeof setInterval> | null = null;
	private playlistKeyToId = new Map<string, string>();

	constructor(client: ConvexHttpClient, roomManager: RoomManager) {
		this.client = client;
		this.roomManager = roomManager;
	}

	start(): void {
		if (this.timer) return;
		console.log(`[convex-sync] Starting poll loop (${POLL_INTERVAL}ms)`);
		this.timer = setInterval(() => this.tick(), POLL_INTERVAL);
		// Also run immediately
		this.tick();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private async tick(): Promise<void> {
		try {
			const roomsByKey = this.roomManager.getRoomsByPlaylistKey();
			if (roomsByKey.size === 0) return;

			for (const [playlistKey, rooms] of roomsByKey) {
				await this.pollPlaylist(playlistKey, rooms);
			}
		} catch (err) {
			console.error("[convex-sync] Poll error:", err);
		}
	}

	async pollPlaylist(
		playlistKey: string,
		rooms: { playlistId: string | undefined; updateQueue: (songs: SongData[], epoch: number) => void; id: string }[],
	): Promise<void> {
		// Resolve playlist key → playlist ID if needed
		let playlistId = this.playlistKeyToId.get(playlistKey);
		if (!playlistId) {
			const playlist = await this.client.query(
				api.playlists.getByPlaylistKey,
				{ playlistKey },
			);
			if (!playlist) return;
			playlistId = playlist._id;
			this.playlistKeyToId.set(playlistKey, playlistId);
			// Update all rooms with the resolved ID
			for (const room of rooms) {
				room.playlistId = playlistId;
			}
		}

		// Fetch playlist for epoch
		const playlist = await this.client.query(api.playlists.get, {
			id: playlistId as never,
		});
		const epoch = playlist?.promptEpoch ?? 0;

		// Fetch song queue
		const songs = await this.client.query(api.songs.getQueue, {
			playlistId: playlistId as never,
		});

		// Map to SongData (protocol-compatible subset)
		const songData: SongData[] = songs.map((s) => ({
			_id: s._id,
			title: s.title,
			artistName: s.artistName,
			genre: s.genre,
			subGenre: s.subGenre,
			coverUrl: s.coverUrl,
			audioUrl: s.audioUrl,
			status: s.status,
			orderIndex: s.orderIndex,
			isInterrupt: s.isInterrupt,
			promptEpoch: s.promptEpoch,
			_creationTime: s._creationTime,
			audioDuration: s.audioDuration,
			mood: s.mood,
			energy: s.energy,
			era: s.era,
			vocalStyle: s.vocalStyle,
			userRating: s.userRating as "up" | "down" | undefined,
			bpm: s.bpm,
			keyScale: s.keyScale,
			lyrics: s.lyrics,
		}));

		for (const room of rooms) {
			room.updateQueue(songData, epoch);
		}
	}

	/** Immediately sync a specific room's playlist (e.g. after auto-create). */
	async syncRoom(room: { playlistKey: string; playlistId: string | undefined; updateQueue: (songs: SongData[], epoch: number) => void; id: string }): Promise<void> {
		try {
			await this.pollPlaylist(room.playlistKey, [room]);
		} catch (err) {
			console.error(`[convex-sync] Failed to sync room "${room.id}":`, err);
		}
	}

	/** Mark a song as "played" via Convex mutation. */
	async markSongPlayed(songId: string): Promise<void> {
		try {
			await this.client.mutation(api.songs.updateStatus, {
				id: songId as never,
				status: "played" as never,
			});
		} catch (err) {
			console.error(`[convex-sync] Failed to mark song ${songId} as played:`, err);
		}
	}
}
