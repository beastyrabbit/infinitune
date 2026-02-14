import amqplib from "amqplib";
import type { InfinituneApiClient } from "../api-server/client";
import type { Song } from "../api-server/types";
import type { SongData } from "./protocol.js";
import type { RoomManager } from "./room-manager.js";

type AmqpConnection = Awaited<ReturnType<typeof amqplib.connect>>;
type AmqpChannel = Awaited<ReturnType<AmqpConnection["createChannel"]>>;

const RABBITMQ_URL =
	process.env.RABBITMQ_URL ?? "amqp://localhost:5672/infinitune";

/** Convert API Song to protocol SongData (null → undefined). */
function toSongData(s: Song): SongData {
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

export class EventSync {
	private apiClient: InfinituneApiClient;
	private roomManager: RoomManager;
	private playlistKeyToId = new Map<string, string>();
	private playlistIdToKey = new Map<string, string>();
	private connection: AmqpConnection | null = null;
	private channel: AmqpChannel | null = null;
	private reconnecting = false;

	constructor(apiClient: InfinituneApiClient, roomManager: RoomManager) {
		this.apiClient = apiClient;
		this.roomManager = roomManager;
	}

	async start(): Promise<void> {
		await this.connectRabbit();
	}

	stop(): void {
		try {
			this.channel?.close();
			this.connection?.close();
		} catch {
			// Ignore close errors
		}
		this.channel = null;
		this.connection = null;
	}

	private async connectRabbit(): Promise<void> {
		try {
			const conn = await amqplib.connect(RABBITMQ_URL);
			this.connection = conn;

			conn.on("error", (err) => {
				console.error("[event-sync] RabbitMQ connection error:", err.message);
			});
			conn.on("close", () => {
				console.warn("[event-sync] RabbitMQ connection closed, reconnecting...");
				this.connection = null;
				this.channel = null;
				this.scheduleReconnect();
			});

			const ch = await conn.createChannel();
			this.channel = ch;

			// Assert events exchange (should already exist from API server)
			await ch.assertExchange("infinitune.events", "topic", { durable: true });

			// Create temporary exclusive queue for this room server instance
			const { queue } = await ch.assertQueue("", {
				exclusive: true,
				autoDelete: true,
			});

			// Bind to song events (all playlists) and playlist events
			await ch.bindQueue(queue, "infinitune.events", "songs.*");
			await ch.bindQueue(queue, "infinitune.events", "playlists");

			await ch.consume(queue, async (msg) => {
				if (!msg) return;
				try {
					const routingKey = msg.fields.routingKey;
					if (routingKey.startsWith("songs.")) {
						const playlistId = routingKey.replace("songs.", "");
						await this.handleSongEvent(playlistId);
					}
					// playlists events could trigger room updates too
				} catch (err) {
					console.error(
						"[event-sync] Error handling event:",
						err instanceof Error ? err.message : err,
					);
				}
				ch.ack(msg);
			});

			console.log("[event-sync] Connected to RabbitMQ, listening for events");
		} catch (err) {
			console.error(
				"[event-sync] RabbitMQ connection failed:",
				err instanceof Error ? err.message : err,
			);
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnecting) return;
		this.reconnecting = true;
		setTimeout(() => {
			this.reconnecting = false;
			this.connectRabbit();
		}, 5000);
	}

	private async handleSongEvent(playlistId: string): Promise<void> {
		// Find the playlist key for this ID
		const playlistKey = this.playlistIdToKey.get(playlistId);
		if (!playlistKey) {
			// We don't know about this playlist yet, skip
			return;
		}

		const roomsByKey = this.roomManager.getRoomsByPlaylistKey();
		const rooms = roomsByKey.get(playlistKey);
		if (!rooms || rooms.length === 0) return;

		await this.fetchAndUpdateRooms(playlistId, rooms);
	}

	private async fetchAndUpdateRooms(
		playlistId: string,
		rooms: {
			playlistId: string | undefined;
			updateQueue: (songs: SongData[], epoch: number) => void;
			id: string;
		}[],
	): Promise<void> {
		// Fetch playlist for epoch
		const playlist = await this.apiClient.getPlaylist(playlistId);
		const epoch = playlist?.promptEpoch ?? 0;

		// Fetch song queue
		const songs = await this.apiClient.getSongQueue(playlistId);
		const songData = songs.map(toSongData);

		for (const room of rooms) {
			room.updateQueue(songData, epoch);
		}
	}

	/** Resolve a playlist key to an ID and sync the room. */
	async syncRoom(room: {
		playlistKey: string;
		playlistId: string | undefined;
		updateQueue: (songs: SongData[], epoch: number) => void;
		id: string;
	}): Promise<void> {
		try {
			// Resolve playlist key → ID
			let playlistId = this.playlistKeyToId.get(room.playlistKey);
			if (!playlistId) {
				const playlist = await this.apiClient.getPlaylistByKey(
					room.playlistKey,
				);
				if (!playlist) return;
				playlistId = playlist._id;
				this.playlistKeyToId.set(room.playlistKey, playlistId);
				this.playlistIdToKey.set(playlistId, room.playlistKey);
				room.playlistId = playlistId;
			}

			await this.fetchAndUpdateRooms(playlistId, [room]);
		} catch (err) {
			console.error(
				`[event-sync] Failed to sync room "${room.id}":`,
				err instanceof Error ? err.message : err,
			);
		}
	}

	/** Mark a song as "played" via API. */
	async markSongPlayed(songId: string): Promise<void> {
		try {
			await this.apiClient.updateStatus(songId, "played");
		} catch (err) {
			console.error(
				`[event-sync] Failed to mark song ${songId} as played:`,
				err instanceof Error ? err.message : err,
			);
		}
	}
}
