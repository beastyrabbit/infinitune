import { pickNextSong } from "@infinitune/shared/pick-next-song";
import type {
	CommandAction,
	Device,
	DeviceMode,
	DeviceRole,
	PlaybackState,
	ServerMessage,
	SongData,
} from "@infinitune/shared/protocol";
import type { WebSocket } from "ws";

interface ConnectedDevice extends Device {
	ws: WebSocket;
	mode: DeviceMode;
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
	private markPlayedCallback: ((songId: string) => Promise<void>) | null = null;
	private lastSeekAt = 0;
	// After play/pause/toggle, bypass sync throttle so the player's
	// immediate sync gets broadcast to controllers right away.
	private syncPriorityUntil = 0;

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

	addDevice(device: Omit<Device, "mode">, ws: WebSocket): void {
		this.devices.set(device.id, { ...device, ws, mode: "default" });
		// Send current state + queue to the new device
		this.sendTo(device.id, this.buildStateMessage());
		if (this.songQueue.length > 0) {
			this.sendTo(device.id, { type: "queue", songs: this.songQueue });
		}
		if (device.role === "player") {
			this.sendCurrentSongTo(device.id);
		}
		this.broadcastState();
	}

	removeDevice(deviceId: string): void {
		this.devices.delete(deviceId);
		this.broadcastState();
	}

	setDeviceRole(deviceId: string, role: DeviceRole): void {
		const device = this.devices.get(deviceId);
		if (!device) return;
		device.role = role;
		if (role === "player") {
			this.sendCurrentSongTo(deviceId);
		}
		this.broadcastState();
	}

	renameDevice(targetDeviceId: string, name: string): void {
		const device = this.devices.get(targetDeviceId);
		if (!device) return;
		device.name = name;
		this.broadcastState();
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

	private setDeviceMode(deviceId: string, mode: DeviceMode): void {
		const device = this.devices.get(deviceId);
		if (device) device.mode = mode;
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
			this.songQueue.find((s) => s._id === this.playback.currentSongId) ?? null
		);
	}

	// ─── Command Handling ───────────────────────────────────────────

	handleCommand(
		_deviceId: string,
		action: CommandAction,
		payload?: Record<string, unknown>,
		targetDeviceId?: string,
	): void {
		// ── resetToDefault (targeted): reset one player back to default mode ──
		if (action === "resetToDefault" && targetDeviceId) {
			this.setDeviceMode(targetDeviceId, "default");
			// Re-send current room state to the device so it syncs back
			this.sendTo(targetDeviceId, {
				type: "execute",
				action: "setVolume",
				payload: { volume: this.playback.volume },
				scope: "room",
			});
			this.sendTo(targetDeviceId, {
				type: "execute",
				action: this.playback.isPlaying ? "play" : "pause",
				scope: "room",
			});
			this.broadcastState();
			return;
		}

		// ── syncAll (room-wide): reset ALL players to default mode ──
		if (action === "syncAll") {
			for (const device of this.devices.values()) {
				if (device.role === "player") {
					device.mode = "default";
				}
			}
			// Broadcast room state to all players (bypassing mode filter)
			this.broadcastExecute(
				"setVolume",
				{ volume: this.playback.volume },
				false,
			);
			this.broadcastExecute(
				this.playback.isPlaying ? "play" : "pause",
				undefined,
				false,
			);
			this.broadcastState();
			return;
		}

		// ── Per-device targeted commands ──
		if (targetDeviceId) {
			switch (action) {
				case "play":
				case "pause":
				case "toggle":
				case "setVolume":
				case "toggleMute":
					this.setDeviceMode(targetDeviceId, "individual");
					this.sendTo(targetDeviceId, {
						type: "execute",
						action,
						payload,
						scope: "device",
					});
					this.broadcastState(); // update controllers about mode change
					break;
			}
			return;
		}

		// ── Room-wide commands ──
		switch (action) {
			case "play":
			case "pause":
			case "toggle": {
				if (action === "play") this.playback.isPlaying = true;
				else if (action === "pause") this.playback.isPlaying = false;
				else this.playback.isPlaying = !this.playback.isPlaying;
				this.syncPriorityUntil = Date.now() + 500;
				this.broadcastExecute(this.playback.isPlaying ? "play" : "pause");
				break;
			}
			case "skip":
				this.handleSongEnded();
				return; // handleSongEnded broadcasts state
			case "seek": {
				const time = (payload?.time as number) ?? 0;
				this.playback.currentTime = time;
				this.lastSeekAt = Date.now();
				this.syncPriorityUntil = Date.now() + 500;
				this.broadcastExecute("seek", { time }, false); // seek goes to all
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
				this.broadcastExecute("rate", payload, false); // rating goes to all
				break;
			}
			case "selectSong": {
				const songId = payload?.songId as string;
				if (!songId) return;
				const song = this.songQueue.find((s) => s._id === songId);
				if (!song?.audioUrl) return;
				this.markCurrentSongPlayed();
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
		_reportedIsPlaying: boolean,
		currentTime: number,
		duration: number,
	): void {
		// After a seek, briefly ignore sync-reported currentTime to prevent
		// stale values from overwriting the authoritative seek position.
		if (Date.now() - this.lastSeekAt > 500) {
			this.playback.currentTime = currentTime;
		}
		this.playback.duration = duration;
		// _reportedIsPlaying is intentionally ignored — room commands (play/pause/toggle)
		// are authoritative. If the player's audio is blocked by autoplay policy,
		// sync would report isPlaying=false and cause UI flicker.
		if (currentSongId) this.playback.currentSongId = currentSongId;

		// After play/pause/toggle/seek, bypass throttle so the first sync
		// from the player reaches controllers immediately.
		if (Date.now() < this.syncPriorityUntil) {
			this.syncPriorityUntil = 0; // consume: only first sync is priority
			this.broadcastState();
		} else {
			this.throttledBroadcastState();
		}
	}

	// ─── Song Ended ─────────────────────────────────────────────────

	handleSongEnded(): void {
		// Debounce: only first report triggers advancement
		if (this.songEndedHandled) return;
		this.songEndedHandled = true;
		setTimeout(() => {
			this.songEndedHandled = false;
		}, 1000);

		this.markCurrentSongPlayed();

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

	/** Clean up timers when the room is being removed. */
	dispose(): void {
		if (this.stateBroadcastTimer) {
			clearTimeout(this.stateBroadcastTimer);
			this.stateBroadcastTimer = null;
		}
	}

	/** Mark the currently playing song as "played" via the callback. */
	private markCurrentSongPlayed(): void {
		if (this.playback.currentSongId && this.markPlayedCallback) {
			const songId = this.playback.currentSongId;
			this.markPlayedCallback(songId).catch((err) => {
				console.error(`[room] Failed to mark song ${songId} as played:`, err);
			});
		}
	}

	/** Tell a player device to load the current song (used on join and role switch). */
	private sendCurrentSongTo(deviceId: string): void {
		const currentSong = this.getCurrentSong();
		if (currentSong?.audioUrl) {
			this.sendTo(deviceId, {
				type: "nextSong",
				songId: currentSong._id,
				audioUrl: currentSong.audioUrl,
			});
		}
	}

	private advanceToSong(song: SongData): void {
		this.playback.currentSongId = song._id;
		this.playback.currentTime = 0;
		this.playback.duration = song.audioDuration ?? 0;
		this.playback.isPlaying = true;
		this.syncPriorityUntil = Date.now() + 1000;

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

	private broadcastExecute(
		action: CommandAction,
		payload?: Record<string, unknown>,
		respectMode = true,
	): void {
		const msg: ServerMessage = {
			type: "execute",
			action,
			payload,
			scope: "room",
		};
		const data = JSON.stringify(msg);
		for (const device of this.devices.values()) {
			if (device.role !== "player" || device.ws.readyState !== 1) continue;
			if (respectMode && device.mode === "individual") continue;
			device.ws.send(data);
		}
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

	private sendTo(deviceId: string, msg: ServerMessage): void {
		const device = this.devices.get(deviceId);
		if (device && device.ws.readyState === 1) {
			device.ws.send(JSON.stringify(msg));
		}
	}
}
