import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Server as NetServer } from "node:net";
import {
	type ClientMessage,
	type CommandAction,
	type PlaybackState,
	ServerMessageSchema,
	type SongData,
} from "@infinitune/shared/protocol";
import WebSocket from "ws";
import { FfplayEngine } from "../audio/ffplay-engine";
import { resolveMediaUrl, toRoomWsUrl } from "../lib/api";
import {
	createIpcServer,
	type DaemonAction,
	type IpcHandler,
} from "../lib/ipc";
import { getRuntimePaths } from "../lib/paths";

const INITIAL_PLAYBACK: PlaybackState = {
	currentSongId: null,
	isPlaying: false,
	currentTime: 0,
	duration: 0,
	volume: 0.8,
	isMuted: false,
};

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value !== "number") return undefined;
	if (!Number.isFinite(value)) return undefined;
	return value;
}

type JoinRoomPayload = {
	serverUrl: string;
	roomId: string;
	playlistKey?: string;
	roomName?: string;
	deviceName?: string;
};

export type DaemonRuntimeOptions = {
	serverUrl?: string;
	roomId?: string;
	playlistKey?: string;
	roomName?: string;
	deviceName: string;
};

export class DaemonRuntime {
	private readonly runtimePaths = getRuntimePaths();
	private readonly deviceId = `infi-${randomUUID().slice(0, 8)}`;
	private readonly ffplay: FfplayEngine;
	private readonly ipcServer: NetServer;
	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private syncTimer: ReturnType<typeof setInterval> | null = null;
	private shouldRun = true;
	private connectionWaiters = new Set<{
		resolve: () => void;
		reject: (error: Error) => void;
		timeout: ReturnType<typeof setTimeout>;
	}>();

	private serverUrl: string | null;
	private roomId: string | null;
	private playlistKey: string | null;
	private roomName: string | null;
	private deviceName: string;

	private connected = false;
	private serverTimeOffset = 0;
	private playback: PlaybackState = { ...INITIAL_PLAYBACK };
	private currentSong: SongData | null = null;
	private queue: SongData[] = [];
	private lastError: string | null = null;

	constructor(options: DaemonRuntimeOptions) {
		this.serverUrl = options.serverUrl ?? null;
		this.roomId = options.roomId ?? null;
		this.playlistKey = options.playlistKey ?? null;
		this.roomName = options.roomName ?? null;
		this.deviceName = options.deviceName;
		this.ffplay = new FfplayEngine(() => {
			this.send({ type: "songEnded" });
		});
		this.ipcServer = createIpcServer(this.handleIpc);
	}

	async start(): Promise<void> {
		fs.mkdirSync(this.runtimePaths.runtimeRoot, { recursive: true });
		if (fs.existsSync(this.runtimePaths.socketPath)) {
			fs.unlinkSync(this.runtimePaths.socketPath);
		}
		fs.writeFileSync(this.runtimePaths.pidPath, `${process.pid}\n`, "utf8");

		await new Promise<void>((resolve, reject) => {
			this.ipcServer.once("error", reject);
			this.ipcServer.listen(this.runtimePaths.socketPath, () => {
				resolve();
			});
		});

		this.syncTimer = setInterval(() => {
			this.sendSyncPulse();
		}, 1000);

		process.on("SIGINT", () => {
			void this.shutdown(0);
		});
		process.on("SIGTERM", () => {
			void this.shutdown(0);
		});

		if (this.serverUrl && this.roomId) {
			this.connect();
		}
	}

	private readonly handleIpc: IpcHandler = async (action, payload) => {
		switch (action) {
			case "status":
				return this.getStatus();
			case "queue":
				return this.queue;
			case "shutdown":
				setTimeout(() => {
					void this.shutdown(0);
				}, 25);
				return { stopping: true };
			case "joinRoom": {
				const joinPayload: JoinRoomPayload = {
					serverUrl: asString(payload?.serverUrl) ?? "",
					roomId: asString(payload?.roomId) ?? "",
					playlistKey: asString(payload?.playlistKey),
					roomName: asString(payload?.roomName),
					deviceName: asString(payload?.deviceName),
				};
				if (!joinPayload.serverUrl || !joinPayload.roomId) {
					throw new Error("joinRoom requires serverUrl and roomId");
				}
				this.serverUrl = joinPayload.serverUrl;
				this.roomId = joinPayload.roomId;
				this.playlistKey = joinPayload.playlistKey ?? null;
				this.roomName = joinPayload.roomName ?? null;
				if (joinPayload.deviceName) this.deviceName = joinPayload.deviceName;
				this.connect();
				await this.waitUntilConnected();
				return this.getStatus();
			}
			case "configure": {
				const nextServerUrl = asString(payload?.serverUrl);
				const nextDeviceName = asString(payload?.deviceName);
				const shouldReconnect =
					(typeof nextServerUrl === "string" &&
						nextServerUrl !== this.serverUrl) ||
					(typeof nextDeviceName === "string" &&
						nextDeviceName !== this.deviceName);

				if (typeof nextServerUrl === "string") {
					this.serverUrl = nextServerUrl;
				}
				if (typeof nextDeviceName === "string") {
					this.deviceName = nextDeviceName;
				}

				if (shouldReconnect && this.roomId && this.serverUrl) {
					this.connect();
				}

				return this.getStatus();
			}
			case "play":
				this.sendCommand("play");
				return { ok: true };
			case "pause":
				this.sendCommand("pause");
				return { ok: true };
			case "toggle":
				this.sendCommand("toggle");
				return { ok: true };
			case "skip":
				this.sendCommand("skip");
				return { ok: true };
			case "setVolume": {
				const value = asNumber(payload?.volume);
				if (value === undefined) {
					throw new Error("setVolume requires numeric payload.volume");
				}
				const next = Math.max(0, Math.min(1, value));
				this.sendCommand("setVolume", { volume: next });
				return { volume: next };
			}
			case "volumeDelta": {
				const delta = asNumber(payload?.delta);
				if (delta === undefined) {
					throw new Error("volumeDelta requires numeric payload.delta");
				}
				const base =
					typeof this.playback.volume === "number"
						? this.playback.volume
						: this.ffplay.getVolume();
				const next = Math.max(0, Math.min(1, base + delta));
				this.sendCommand("setVolume", { volume: next });
				return { volume: next };
			}
			case "toggleMute":
				this.sendCommand("toggleMute");
				return { ok: true };
			case "selectSong": {
				const songId = asString(payload?.songId);
				if (!songId) {
					throw new Error("selectSong requires payload.songId");
				}
				this.sendCommand("selectSong", { songId });
				return { ok: true };
			}
			case "seek": {
				const time = asNumber(payload?.time);
				if (time === undefined) {
					throw new Error("seek requires numeric payload.time");
				}
				this.sendCommand("seek", { time: Math.max(0, time) });
				return { ok: true };
			}
		}
	};

	private connect(): void {
		if (!this.serverUrl || !this.roomId) return;
		this.disconnect(false);
		const roomId = this.roomId;

		const wsUrl = toRoomWsUrl(this.serverUrl);
		const ws = new WebSocket(wsUrl);
		this.ws = ws;

		ws.on("open", () => {
			if (this.ws !== ws) return;
			this.connected = false;
			this.lastError = null;
			const join: ClientMessage = {
				type: "join",
				roomId,
				deviceId: this.deviceId,
				deviceName: this.deviceName,
				role: "player",
				playlistKey: this.playlistKey ?? undefined,
				roomName: this.roomName ?? undefined,
			};
			this.send(join);
			for (let i = 0; i < 5; i += 1) {
				setTimeout(() => {
					this.send({ type: "ping", clientTime: Date.now() });
				}, i * 150);
			}
		});

		ws.on("message", (data) => {
			if (this.ws !== ws) return;
			this.handleServerMessage(data.toString());
		});

		ws.on("error", (error) => {
			if (this.ws !== ws) return;
			this.lastError = error.message;
			if (!this.connected) {
				this.rejectConnectionWaiters(
					new Error(`Failed to connect to room socket: ${error.message}`),
				);
			}
		});

		ws.on("close", () => {
			if (this.ws !== ws) return;
			const wasConnected = this.connected;
			this.connected = false;
			this.ws = null;
			if (!wasConnected) {
				this.rejectConnectionWaiters(new Error("Room socket closed"));
			}
			if (!this.shouldRun || !this.roomId || !this.serverUrl) return;
			this.reconnectTimer = setTimeout(() => {
				this.connect();
			}, 1500);
		});
	}

	private disconnect(clearRoom: boolean): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.rejectConnectionWaiters(new Error("Connection replaced"));
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				// Ignore close failures.
			}
			this.ws = null;
		}
		this.connected = false;
		if (clearRoom) {
			this.roomId = null;
			this.playlistKey = null;
			this.roomName = null;
		}
	}

	private handleServerMessage(raw: string): void {
		let parsedRaw: unknown;
		try {
			parsedRaw = JSON.parse(raw);
		} catch {
			return;
		}

		const parsed = ServerMessageSchema.safeParse(parsedRaw);
		if (!parsed.success) return;

		const message = parsed.data;
		switch (message.type) {
			case "state":
				if (!this.connected) {
					this.connected = true;
					this.resolveConnectionWaiters();
				}
				this.playback = message.playback;
				this.currentSong = message.currentSong;
				break;
			case "queue":
				this.queue = message.songs;
				break;
			case "pong": {
				const now = Date.now();
				const roundTrip = now - message.clientTime;
				this.serverTimeOffset =
					message.serverTime - message.clientTime - roundTrip / 2;
				break;
			}
			case "execute":
				this.applyExecute(message.action, message.payload);
				break;
			case "nextSong": {
				if (!this.serverUrl) return;
				const songUrl = resolveMediaUrl(this.serverUrl, message.audioUrl);
				this.ffplay.loadSong(
					message.songId,
					songUrl,
					message.startAt,
					this.serverTimeOffset,
				);
				break;
			}
			case "preload": {
				if (!this.serverUrl) return;
				const songUrl = resolveMediaUrl(this.serverUrl, message.audioUrl);
				this.ffplay.preload(message.songId, songUrl);
				break;
			}
			case "error":
				this.lastError = message.message;
				if (!this.connected) {
					this.rejectConnectionWaiters(new Error(message.message));
				}
				break;
		}
	}

	private applyExecute(
		action: string,
		payload?: Record<string, unknown>,
	): void {
		switch (action) {
			case "play":
				this.ffplay.play();
				break;
			case "pause":
				this.ffplay.pause();
				break;
			case "toggle":
				this.ffplay.toggle();
				break;
			case "seek": {
				const time = asNumber(payload?.time) ?? 0;
				this.ffplay.seek(time);
				break;
			}
			case "setVolume": {
				const volume = asNumber(payload?.volume) ?? 0.8;
				this.ffplay.setVolume(volume);
				break;
			}
			case "toggleMute":
				this.ffplay.toggleMute();
				break;
		}
	}

	private send(message: ClientMessage): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify(message));
	}

	private sendCommand(
		action: CommandAction,
		payload?: Record<string, unknown>,
	): void {
		const ws = this.ws;
		if (!this.connected || !ws || ws.readyState !== WebSocket.OPEN) {
			throw new Error("Daemon is not connected to a room yet.");
		}
		ws.send(JSON.stringify({ type: "command", action, payload }));
	}

	private sendSyncPulse(): void {
		if (!this.connected) return;
		const snapshot = this.ffplay.getSnapshot();
		if (!snapshot.songId) return;
		this.send({
			type: "sync",
			currentSongId: snapshot.songId,
			isPlaying: snapshot.isPlaying,
			currentTime: snapshot.currentTime,
			duration: this.playback.duration,
		});
	}

	private getStatus(): Record<string, unknown> {
		return {
			pid: process.pid,
			connected: this.connected,
			deviceId: this.deviceId,
			deviceName: this.deviceName,
			serverUrl: this.serverUrl,
			roomId: this.roomId,
			playlistKey: this.playlistKey,
			playback: this.playback,
			currentSong: this.currentSong,
			queueLength: this.queue.length,
			engine: this.ffplay.getSnapshot(),
			lastError: this.lastError,
		};
	}

	private waitUntilConnected(timeoutMs = 5000): Promise<void> {
		const ws = this.ws;
		if (this.connected && ws && ws.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve, reject) => {
			const waiter = {
				resolve: () => {
					clearTimeout(waiter.timeout);
					this.connectionWaiters.delete(waiter);
					resolve();
				},
				reject: (error: Error) => {
					clearTimeout(waiter.timeout);
					this.connectionWaiters.delete(waiter);
					reject(error);
				},
				timeout: setTimeout(() => {
					this.connectionWaiters.delete(waiter);
					reject(
						new Error(`Timed out waiting for room connection (${timeoutMs}ms)`),
					);
				}, timeoutMs),
			};
			this.connectionWaiters.add(waiter);
		});
	}

	private resolveConnectionWaiters(): void {
		if (this.connectionWaiters.size === 0) return;
		const waiters = Array.from(this.connectionWaiters);
		this.connectionWaiters.clear();
		for (const waiter of waiters) {
			clearTimeout(waiter.timeout);
			waiter.resolve();
		}
	}

	private rejectConnectionWaiters(error: Error): void {
		if (this.connectionWaiters.size === 0) return;
		const waiters = Array.from(this.connectionWaiters);
		this.connectionWaiters.clear();
		for (const waiter of waiters) {
			clearTimeout(waiter.timeout);
			waiter.reject(error);
		}
	}

	async shutdown(exitCode: number): Promise<void> {
		this.shouldRun = false;
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		this.disconnect(true);
		this.ffplay.destroy();

		await new Promise<void>((resolve) => {
			this.ipcServer.close(() => resolve());
		});

		if (fs.existsSync(this.runtimePaths.socketPath)) {
			fs.unlinkSync(this.runtimePaths.socketPath);
		}
		if (fs.existsSync(this.runtimePaths.pidPath)) {
			fs.unlinkSync(this.runtimePaths.pidPath);
		}
		process.exit(exitCode);
	}
}

export async function runDaemonRuntime(
	options: DaemonRuntimeOptions,
): Promise<void> {
	const runtime = new DaemonRuntime(options);
	await runtime.start();
}

export function daemonActionFromCommand(command: string): DaemonAction | null {
	switch (command) {
		case "play":
		case "pause":
		case "toggle":
		case "skip":
		case "toggleMute":
			return command;
		default:
			return null;
	}
}
