import type { WebSocket } from "ws";
import type {
	CommandAction,
	Device,
	DeviceRole,
	PlaybackState,
	ServerMessage,
	SongData,
} from "./protocol.js";
import { pickNextSong } from "./pick-next-song.js";

interface ConnectedDevice extends Device {
	ws: WebSocket;
}

export class Room {
	readonly id: string;
	readonly name: string;
	readonly playlistKey: string;
	playlistId: string | undefined;
	playlistEpoch = 0;

	playback: PlaybackState = {
		currentSongId: null,
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: 0.8,
		isMuted: false,
	};

	private devices = new Map<string, ConnectedDevice>();
	private songQueue: SongData[] = [];
	private songEndedHandled = false;
	private lastStateBroadcast = 0;
	private stateBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
	private markPlayedCallback:
		| ((songId: string) => Promise<void>)
		| null = null;

	constructor(
		id: string,
		name: string,
		playlistKey: string,
		markPlayedCallback?: (songId: string) => Promise<void>,
	) {
		this.id = id;
		this.name = name;
		this.playlistKey = playlistKey;
		if (markPlayedCallback) this.markPlayedCallback = markPlayedCallback;
	}

	// ─── Device Management ──────────────────────────────────────────

	addDevice(device: Device, ws: WebSocket): void {
		this.devices.set(device.id, { ...device, ws });
		// Send current state + queue to the new device
		this.sendTo(device.id, this.buildStateMessage());
		if (this.songQueue.length > 0) {
			this.sendTo(device.id, { type: "queue", songs: this.songQueue });
		}
		// If this is a player and there's a song playing, tell it to load audio
		if (device.role === "player") {
			const currentSong = this.getCurrentSong();
			if (currentSong?.audioUrl) {
				this.sendTo(device.id, {
					type: "nextSong",
					songId: currentSong._id,
					audioUrl: currentSong.audioUrl,
				});
			}
		}
		this.broadcastState();
	}

	removeDevice(deviceId: string): void {
		this.devices.delete(deviceId);
		this.broadcastState();
	}

	setDeviceRole(deviceId: string, role: DeviceRole): void {
		const device = this.devices.get(deviceId);
		if (device) {
			device.role = role;
			// If switching to player and there's a song playing, send it
			if (role === "player") {
				const currentSong = this.getCurrentSong();
				if (currentSong?.audioUrl) {
					this.sendTo(deviceId, {
						type: "nextSong",
						songId: currentSong._id,
						audioUrl: currentSong.audioUrl,
					});
				}
			}
			this.broadcastState();
		}
	}

	renameDevice(targetDeviceId: string, name: string): void {
		const device = this.devices.get(targetDeviceId);
		if (device) {
			device.name = name;
			this.broadcastState();
		}
	}

	getDeviceCount(): number {
		return this.devices.size;
	}

	isEmpty(): boolean {
		return this.devices.size === 0;
	}

	getDevices(): Device[] {
		return Array.from(this.devices.values()).map(({ ws: _, ...d }) => d);
	}

	// ─── Song Queue ─────────────────────────────────────────────────

	updateQueue(songs: SongData[], playlistEpoch: number): void {
		this.songQueue = songs;
		this.playlistEpoch = playlistEpoch;
		this.broadcast({ type: "queue", songs });

		// If we have no current song but there are ready songs, auto-start
		if (!this.playback.currentSongId) {
			const next = pickNextSong(songs, null, playlistEpoch);
			if (next?.audioUrl) {
				this.advanceToSong(next);
			}
		}

		// Preload the next song for players
		this.sendPreloadHint();
	}

	getQueue(): SongData[] {
		return this.songQueue;
	}

	getCurrentSong(): SongData | null {
		if (!this.playback.currentSongId) return null;
		return (
			this.songQueue.find((s) => s._id === this.playback.currentSongId) ??
			null
		);
	}

	// ─── Command Handling ───────────────────────────────────────────

	handleCommand(
		_deviceId: string,
		action: CommandAction,
		payload?: Record<string, unknown>,
		targetDeviceId?: string,
	): void {
		// Per-device targeted commands
		if (targetDeviceId) {
			switch (action) {
				case "play":
				case "pause":
				case "toggle":
				case "setVolume":
				case "toggleMute":
					this.sendToDevice(targetDeviceId, {
						type: "execute",
						action,
						payload,
					});
					break;
			}
			// Targeted commands don't update room-wide state
			return;
		}

		switch (action) {
			case "play":
				this.playback.isPlaying = true;
				this.broadcastExecute("play");
				break;
			case "pause":
				this.playback.isPlaying = false;
				this.broadcastExecute("pause");
				break;
			case "toggle":
				this.playback.isPlaying = !this.playback.isPlaying;
				this.broadcastExecute(this.playback.isPlaying ? "play" : "pause");
				break;
			case "skip":
				this.handleSongEnded();
				return; // handleSongEnded broadcasts state
			case "seek": {
				const time = (payload?.time as number) ?? 0;
				this.playback.currentTime = time;
				this.broadcastExecute("seek", { time });
				break;
			}
			case "setVolume": {
				const volume = (payload?.volume as number) ?? 0.8;
				this.playback.volume = volume;
				this.broadcastExecute("setVolume", { volume });
				break;
			}
			case "toggleMute":
				this.playback.isMuted = !this.playback.isMuted;
				this.broadcastExecute("toggleMute");
				break;
			case "rate": {
				// Rating is just forwarded — Convex mutation happens elsewhere
				this.broadcastExecute("rate", payload);
				break;
			}
			case "selectSong": {
				const songId = payload?.songId as string;
				if (!songId) return;
				const song = this.songQueue.find((s) => s._id === songId);
				if (!song?.audioUrl) return;
				// Mark previous song as played
				if (this.playback.currentSongId && this.markPlayedCallback) {
					this.markPlayedCallback(this.playback.currentSongId).catch(() => {});
				}
				this.advanceToSong(song);
				return;
			}
		}
		this.broadcastState();
	}

	// ─── Sync from Player ───────────────────────────────────────────

	handleSync(
		_deviceId: string,
		currentSongId: string | null,
		isPlaying: boolean,
		currentTime: number,
		duration: number,
	): void {
		this.playback.currentTime = currentTime;
		this.playback.duration = duration;
		this.playback.isPlaying = isPlaying;
		if (currentSongId) this.playback.currentSongId = currentSongId;
		this.throttledBroadcastState();
	}

	// ─── Song Ended ─────────────────────────────────────────────────

	handleSongEnded(): void {
		// Debounce: only first report triggers advancement
		if (this.songEndedHandled) return;
		this.songEndedHandled = true;
		setTimeout(() => {
			this.songEndedHandled = false;
		}, 1000);

		// Mark current song as played
		if (this.playback.currentSongId && this.markPlayedCallback) {
			this.markPlayedCallback(this.playback.currentSongId).catch(() => {});
		}

		const currentSong = this.getCurrentSong();
		const next = pickNextSong(
			this.songQueue,
			this.playback.currentSongId,
			this.playlistEpoch,
			currentSong?.orderIndex,
		);

		if (next?.audioUrl) {
			this.advanceToSong(next);
		} else {
			// No more songs — stop playback
			this.playback.isPlaying = false;
			this.playback.currentSongId = null;
			this.playback.currentTime = 0;
			this.playback.duration = 0;
			this.broadcastState();
		}
	}

	// ─── Ping/Pong ──────────────────────────────────────────────────

	handlePing(deviceId: string, clientTime: number): void {
		this.sendTo(deviceId, {
			type: "pong",
			clientTime,
			serverTime: Date.now(),
		});
	}

	// ─── Private Helpers ────────────────────────────────────────────

	private advanceToSong(song: SongData): void {
		this.playback.currentSongId = song._id;
		this.playback.currentTime = 0;
		this.playback.duration = song.audioDuration ?? 0;
		this.playback.isPlaying = true;

		const startAt = Date.now() + 500; // 500ms buffer for network

		// Tell all players to load and play
		this.broadcastToPlayers({
			type: "nextSong",
			songId: song._id,
			audioUrl: song.audioUrl!,
			startAt,
		});

		this.broadcastState();
		this.sendPreloadHint();
	}

	private sendPreloadHint(): void {
		const currentSong = this.getCurrentSong();
		const next = pickNextSong(
			this.songQueue,
			this.playback.currentSongId,
			this.playlistEpoch,
			currentSong?.orderIndex,
		);
		if (next?.audioUrl) {
			this.broadcastToPlayers({
				type: "preload",
				songId: next._id,
				audioUrl: next.audioUrl,
			});
		}
	}

	private buildStateMessage(): ServerMessage {
		return {
			type: "state",
			playback: { ...this.playback },
			currentSong: this.getCurrentSong(),
			devices: this.getDevices(),
		};
	}

	private broadcastState(): void {
		this.lastStateBroadcast = Date.now();
		this.broadcast(this.buildStateMessage());
	}

	private throttledBroadcastState(): void {
		const now = Date.now();
		const elapsed = now - this.lastStateBroadcast;
		if (elapsed >= 1000) {
			this.broadcastState();
			return;
		}
		// Schedule a broadcast for later if not already scheduled
		if (!this.stateBroadcastTimer) {
			this.stateBroadcastTimer = setTimeout(() => {
				this.stateBroadcastTimer = null;
				this.broadcastState();
			}, 1000 - elapsed);
		}
	}

	private broadcastExecute(action: CommandAction, payload?: Record<string, unknown>): void {
		const msg: ServerMessage = { type: "execute", action, payload };
		this.broadcastToPlayers(msg);
	}

	private broadcastToPlayers(msg: ServerMessage): void {
		const data = JSON.stringify(msg);
		for (const device of this.devices.values()) {
			if (device.role === "player" && device.ws.readyState === 1) {
				device.ws.send(data);
			}
		}
	}

	private broadcast(msg: ServerMessage): void {
		const data = JSON.stringify(msg);
		for (const device of this.devices.values()) {
			if (device.ws.readyState === 1) {
				device.ws.send(data);
			}
		}
	}

	private sendToDevice(deviceId: string, msg: ServerMessage): void {
		const device = this.devices.get(deviceId);
		if (device && device.ws.readyState === 1) {
			device.ws.send(JSON.stringify(msg));
		}
	}

	private sendTo(deviceId: string, msg: ServerMessage): void {
		this.sendToDevice(deviceId, msg);
	}
}
