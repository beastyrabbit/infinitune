import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
	createServer,
	type Server as HttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { createConnection, type Server as NetServer } from "node:net";
import {
	type ClientMessage,
	type CommandAction,
	type PlaybackState,
	ServerMessageSchema,
	type SongData,
} from "@infinitune/shared/protocol";
import type { Song } from "@infinitune/shared/types";
import WebSocket from "ws";
import { FfplayEngine } from "../audio/ffplay-engine";
import {
	heartbeatPlaylist,
	listSongsByPlaylist,
	resolveMediaUrl,
	toRoomWsUrl,
	updatePlaylistPosition,
	updateSongStatus,
} from "../lib/api";
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

const LOCAL_QUEUE_REFRESH_MS = 4_000;
const LOCAL_HEARTBEAT_MS = 30_000;
const LOCAL_START_SONGS_FROM_END = 10;

type PlaybackMode = "room" | "local";

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

function asInteger(value: unknown): number | undefined {
	const num = asNumber(value);
	if (num === undefined || !Number.isInteger(num)) return undefined;
	return num;
}

function isValidTcpPort(value: number): boolean {
	return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function formatRuntimeClock(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (hours > 0) {
		return `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	}
	return `${String(minutes)}:${String(secs).padStart(2, "0")}`;
}

function formatHttpOrigin(host: string, port: number): string {
	const normalizedHost =
		host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `http://${normalizedHost}:${String(port)}`;
}

function toSongData(song: Song): SongData {
	return {
		id: song.id,
		title: song.title ?? undefined,
		artistName: song.artistName ?? undefined,
		genre: song.genre ?? undefined,
		subGenre: song.subGenre ?? undefined,
		coverUrl: song.coverUrl ?? undefined,
		audioUrl: song.audioUrl ?? undefined,
		status: song.status,
		orderIndex: song.orderIndex,
		isInterrupt: song.isInterrupt ?? undefined,
		promptEpoch: song.promptEpoch ?? undefined,
		createdAt: song.createdAt,
		audioDuration: song.audioDuration ?? undefined,
		mood: song.mood ?? undefined,
		energy: song.energy ?? undefined,
		era: song.era ?? undefined,
		vocalStyle: song.vocalStyle ?? undefined,
		userRating: song.userRating ?? undefined,
		bpm: song.bpm ?? undefined,
		keyScale: song.keyScale ?? undefined,
		lyrics: song.lyrics ?? undefined,
	};
}

type JoinRoomPayload = {
	serverUrl: string;
	roomId: string;
	playlistKey?: string;
	roomName?: string;
	deviceName?: string;
};

type StartLocalPayload = {
	serverUrl: string;
	playlistId: string;
	playlistKey?: string;
	playlistName?: string;
	deviceName?: string;
};

export type DaemonRuntimeOptions = {
	serverUrl?: string;
	roomId?: string;
	playlistKey?: string;
	roomName?: string;
	deviceName: string;
	daemonHttpHost?: string;
	daemonHttpPort?: number;
};

export class DaemonRuntime {
	private readonly runtimePaths = getRuntimePaths();
	private readonly deviceId = `infi-${randomUUID().slice(0, 8)}`;
	private readonly ffplay: FfplayEngine;
	private readonly ipcServer: NetServer;
	private httpServer: HttpServer | null = null;
	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private syncTimer: ReturnType<typeof setInterval> | null = null;
	private localRefreshTimer: ReturnType<typeof setInterval> | null = null;
	private localHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
	private daemonHttpHost: string;
	private daemonHttpPort: number;
	private mode: PlaybackMode = "room";
	private localPlaylistId: string | null = null;
	private localPlaylistName: string | null = null;

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
		this.daemonHttpHost = options.daemonHttpHost?.trim().length
			? options.daemonHttpHost.trim()
			: "127.0.0.1";
		this.daemonHttpPort = isValidTcpPort(options.daemonHttpPort ?? -1)
			? (options.daemonHttpPort as number)
			: 17653;
		this.ffplay = new FfplayEngine(() => {
			if (this.mode === "local") {
				void this.handleLocalSongEnded();
				return;
			}
			this.send({ type: "songEnded" });
		});
		this.ipcServer = createIpcServer(this.handleIpc);
	}

	async start(): Promise<void> {
		fs.mkdirSync(this.runtimePaths.runtimeRoot, { recursive: true });
		await this.ensureSocketPathReady();
		fs.writeFileSync(this.runtimePaths.pidPath, `${process.pid}\n`, "utf8");

		await new Promise<void>((resolve, reject) => {
			this.ipcServer.once("error", reject);
			this.ipcServer.listen(this.runtimePaths.socketPath, () => {
				resolve();
			});
		});
		await this.startHttpServer();

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
				this.stopLocalMode();
				this.mode = "room";
				this.queue = [];
				this.serverUrl = joinPayload.serverUrl;
				this.roomId = joinPayload.roomId;
				this.playlistKey = joinPayload.playlistKey ?? null;
				this.roomName = joinPayload.roomName ?? null;
				if (joinPayload.deviceName) this.deviceName = joinPayload.deviceName;
				this.connect();
				await this.waitUntilConnected();
				return this.getStatus();
			}
			case "startLocal": {
				const localPayload: StartLocalPayload = {
					serverUrl: asString(payload?.serverUrl) ?? "",
					playlistId: asString(payload?.playlistId) ?? "",
					playlistKey: asString(payload?.playlistKey),
					playlistName: asString(payload?.playlistName),
					deviceName: asString(payload?.deviceName),
				};
				if (!localPayload.serverUrl || !localPayload.playlistId) {
					throw new Error("startLocal requires serverUrl and playlistId");
				}
				if (localPayload.deviceName) this.deviceName = localPayload.deviceName;
				await this.startLocalMode(localPayload);
				return this.getStatus();
			}
			case "leaveRoom":
				this.leaveRoomSession();
				return this.getStatus();
			case "leavePlaylist":
				this.leavePlaylistSession();
				return this.getStatus();
			case "clearSession":
				this.clearSession();
				return this.getStatus();
			case "configure": {
				const nextServerUrl = asString(payload?.serverUrl);
				const nextDeviceName = asString(payload?.deviceName);
				const nextModeRaw = asString(payload?.playbackMode);
				const nextDaemonHttpHost = asString(payload?.daemonHttpHost);
				const daemonHttpPortRaw = payload?.daemonHttpPort;
				const nextDaemonHttpPort =
					daemonHttpPortRaw === undefined
						? undefined
						: asInteger(daemonHttpPortRaw);
				const nextMode =
					nextModeRaw === "local" || nextModeRaw === "room"
						? nextModeRaw
						: undefined;
				if (
					daemonHttpPortRaw !== undefined &&
					nextDaemonHttpPort === undefined
				) {
					throw new Error(
						"daemonHttpPort must be an integer between 1 and 65535",
					);
				}
				if (
					typeof nextDaemonHttpPort === "number" &&
					!isValidTcpPort(nextDaemonHttpPort)
				) {
					throw new Error(
						"daemonHttpPort must be an integer between 1 and 65535",
					);
				}
				const shouldReconnect =
					(typeof nextServerUrl === "string" &&
						nextServerUrl !== this.serverUrl) ||
					(typeof nextDeviceName === "string" &&
						nextDeviceName !== this.deviceName);
				const shouldRestartHttp =
					(typeof nextDaemonHttpHost === "string" &&
						nextDaemonHttpHost !== this.daemonHttpHost) ||
					(typeof nextDaemonHttpPort === "number" &&
						nextDaemonHttpPort !== this.daemonHttpPort);

				if (typeof nextServerUrl === "string") {
					this.serverUrl = nextServerUrl;
				}
				if (typeof nextDeviceName === "string") {
					this.deviceName = nextDeviceName;
				}
				if (typeof nextDaemonHttpHost === "string") {
					this.daemonHttpHost = nextDaemonHttpHost;
				}
				if (typeof nextDaemonHttpPort === "number") {
					this.daemonHttpPort = nextDaemonHttpPort;
				}

				if (nextMode === "room" && this.mode !== "room") {
					this.stopLocalMode();
					this.mode = "room";
					this.disconnect(false);
					this.playlistKey = null;
				}

				if (nextMode === "local" && this.mode !== "local") {
					this.mode = "local";
					this.disconnect(false);
					this.roomId = null;
					this.roomName = null;
					this.connected = false;
				}

				if (shouldReconnect) {
					if (this.mode === "room" && this.roomId && this.serverUrl) {
						this.connect();
					}
					if (this.mode === "local" && this.localPlaylistId && this.serverUrl) {
						await this.refreshLocalQueue();
					}
				}
				if (shouldRestartHttp) {
					await this.restartHttpServer();
				}

				return this.getStatus();
			}
			case "play":
				if (this.mode === "local") {
					this.playLocal();
				} else {
					this.sendCommand("play");
					// Apply play locally immediately to avoid perceived command lag.
					this.ffplay.play();
					this.playback.isPlaying = true;
				}
				return { ok: true };
			case "pause":
				if (this.mode === "local") {
					this.ffplay.pause();
					this.playback.isPlaying = false;
				} else {
					this.sendCommand("pause");
					// Stop local audio immediately while room state catches up.
					this.ffplay.pause();
					this.playback.isPlaying = false;
				}
				return { ok: true };
			case "toggle":
				if (this.mode === "local") {
					this.ffplay.toggle();
					this.playback.isPlaying = this.ffplay.isPlaying();
				} else {
					this.sendCommand("toggle");
				}
				return { ok: true };
			case "skip":
				if (this.mode === "local") {
					void this.handleLocalSongEnded();
				} else {
					this.sendCommand("skip");
				}
				return { ok: true };
			case "setVolume": {
				const value = asNumber(payload?.volume);
				if (value === undefined) {
					throw new Error("setVolume requires numeric payload.volume");
				}
				const next = Math.max(0, Math.min(1, value));
				if (this.mode === "local") {
					this.ffplay.setVolume(next);
					this.playback.volume = this.ffplay.getVolume();
				} else {
					this.sendCommand("setVolume", { volume: next });
				}
				return { volume: next };
			}
			case "volumeDelta": {
				const delta = asNumber(payload?.delta);
				if (delta === undefined) {
					throw new Error("volumeDelta requires numeric payload.delta");
				}
				const base =
					this.mode === "local"
						? this.ffplay.getVolume()
						: typeof this.playback.volume === "number"
							? this.playback.volume
							: this.ffplay.getVolume();
				const next = Math.max(0, Math.min(1, base + delta));
				if (this.mode === "local") {
					this.ffplay.setVolume(next);
					this.playback.volume = this.ffplay.getVolume();
				} else {
					this.sendCommand("setVolume", { volume: next });
				}
				return { volume: next };
			}
			case "toggleMute":
				if (this.mode === "local") {
					this.ffplay.toggleMute();
					this.playback.isMuted = this.ffplay.isMuted();
				} else {
					this.sendCommand("toggleMute");
				}
				return { ok: true };
			case "selectSong": {
				const songId = asString(payload?.songId);
				if (!songId) {
					throw new Error("selectSong requires payload.songId");
				}
				if (this.mode === "local") {
					this.selectLocalSong(songId);
				} else {
					this.sendCommand("selectSong", { songId });
				}
				return { ok: true };
			}
			case "seek": {
				const time = asNumber(payload?.time);
				if (time === undefined) {
					throw new Error("seek requires numeric payload.time");
				}
				const nextTime = Math.max(0, time);
				if (this.mode === "local") {
					this.ffplay.seek(nextTime);
					this.playback.currentTime = nextTime;
				} else {
					this.sendCommand("seek", { time: nextTime });
				}
				return { ok: true };
			}
		}
	};

	private connect(): void {
		if (this.mode !== "room") return;
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
			this.send({ type: "ping", clientTime: Date.now() });
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
		if (this.mode !== "room") {
			throw new Error("Daemon is in local mode; room command is unavailable.");
		}
		const ws = this.ws;
		if (!this.connected || !ws || ws.readyState !== WebSocket.OPEN) {
			throw new Error("Daemon is not connected to a room yet.");
		}
		ws.send(JSON.stringify({ type: "command", action, payload }));
	}

	private sendSyncPulse(): void {
		if (this.mode === "local") {
			this.syncLocalPlaybackSnapshot();
			return;
		}
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
			mode: this.mode,
			connected: this.connected,
			deviceId: this.deviceId,
			deviceName: this.deviceName,
			serverUrl: this.serverUrl,
			roomId: this.roomId,
			localPlaylistId: this.localPlaylistId,
			localPlaylistName: this.localPlaylistName,
			playlistKey: this.playlistKey,
			playback: this.playback,
			currentSong: this.currentSong,
			queueLength: this.queue.length,
			daemonHttpHost: this.daemonHttpHost,
			daemonHttpPort: this.daemonHttpPort,
			daemonHttpUrl: formatHttpOrigin(this.daemonHttpHost, this.daemonHttpPort),
			engine: this.ffplay.getSnapshot(),
			lastError: this.lastError,
		};
	}

	private async startHttpServer(): Promise<void> {
		const host = this.daemonHttpHost;
		const port = this.daemonHttpPort;
		await new Promise<void>((resolve, reject) => {
			const server = createServer(this.handleHttpRequest);
			let settled = false;
			const onError = (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				server.removeListener("listening", onListening);
				this.httpServer = null;
				reject(
					new Error(
						`Failed to bind daemon HTTP endpoint (${formatHttpOrigin(host, port)}): ${error.message} [${error.code ?? "UNKNOWN"}]`,
					),
				);
			};
			const onListening = () => {
				if (settled) return;
				settled = true;
				server.removeListener("error", onError);
				this.httpServer = server;
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			server.listen(port, host);
		});
	}

	private async ensureSocketPathReady(): Promise<void> {
		const socketPath = this.runtimePaths.socketPath;
		const pidPath = this.runtimePaths.pidPath;

		const pidFromFile = (() => {
			if (!fs.existsSync(pidPath)) return null;
			try {
				const raw = fs.readFileSync(pidPath, "utf8").trim();
				const parsed = Number(raw);
				if (!Number.isInteger(parsed) || parsed <= 0) return null;
				return parsed;
			} catch {
				return null;
			}
		})();
		const pidRunning =
			pidFromFile !== null && this.isProcessRunning(pidFromFile);

		if (!fs.existsSync(socketPath)) {
			if (!pidRunning) return;
			throw new Error(
				`Daemon appears to be running (pid ${pidFromFile}) but socket is missing: ${socketPath}`,
			);
		}

		const socketActive = await new Promise<boolean>((resolve) => {
			let settled = false;
			const socket = createConnection(socketPath);
			socket.once("connect", () => {
				if (settled) return;
				settled = true;
				socket.end();
				resolve(true);
			});
			socket.once("error", () => {
				if (settled) return;
				settled = true;
				resolve(false);
			});
			socket.setTimeout(300, () => {
				if (settled) return;
				settled = true;
				socket.destroy();
				resolve(true);
			});
		});

		if (socketActive) {
			if (pidRunning) {
				throw new Error(
					`Daemon already running (pid ${pidFromFile}, socket in use): ${socketPath}`,
				);
			}
			throw new Error(`Daemon already running (socket in use): ${socketPath}`);
		}

		if (pidRunning) {
			throw new Error(
				`Daemon appears to be running (pid ${pidFromFile}) but socket is not accepting connections`,
			);
		}

		try {
			fs.unlinkSync(socketPath);
		} catch {
			// Best-effort stale socket cleanup.
		}

		if (fs.existsSync(pidPath)) {
			try {
				fs.unlinkSync(pidPath);
			} catch {
				// Best-effort stale pid cleanup.
			}
		}
	}

	private isProcessRunning(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	private async stopHttpServer(): Promise<void> {
		const server = this.httpServer;
		if (!server) return;
		this.httpServer = null;
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
		});
	}

	private async restartHttpServer(): Promise<void> {
		await this.stopHttpServer();
		try {
			await this.startHttpServer();
			this.lastError = null;
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	private readonly handleHttpRequest = (
		req: IncomingMessage,
		res: ServerResponse,
	): void => {
		const method = req.method ?? "GET";
		let pathname = "/";
		try {
			pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		} catch {
			this.writeJson(res, 400, { error: "Invalid request URL" });
			return;
		}

		if (method !== "GET") {
			this.writeJson(res, 405, { error: "Method not allowed" });
			return;
		}

		switch (pathname) {
			case "/":
			case "/health":
				this.writeJson(res, 200, {
					ok: true,
					pid: process.pid,
					mode: this.mode,
				});
				return;
			case "/status":
				this.writeJson(res, 200, this.getStatus());
				return;
			case "/queue":
				this.writeJson(res, 200, this.queue);
				return;
			case "/waybar":
				this.writeJson(res, 200, this.getWaybarPayload());
				return;
			default:
				this.writeJson(res, 404, { error: "Not found" });
				return;
		}
	};

	private writeJson(
		res: ServerResponse,
		statusCode: number,
		payload: unknown,
	): void {
		res.statusCode = statusCode;
		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.setHeader("Cache-Control", "no-store");
		res.end(`${JSON.stringify(payload)}\n`);
	}

	private getWaybarPayload(): Record<string, unknown> {
		const playback = this.playback;
		const currentSong = this.currentSong;
		const title =
			typeof currentSong?.title === "string" &&
			currentSong.title.trim().length > 0
				? currentSong.title.trim()
				: null;
		const artist =
			typeof currentSong?.artistName === "string" &&
			currentSong.artistName.trim().length > 0
				? currentSong.artistName.trim()
				: null;
		const songId = currentSong?.id ?? playback.currentSongId ?? null;
		const runtime = Math.max(0, playback.currentTime || 0);
		const duration =
			typeof playback.duration === "number" && playback.duration > 0
				? playback.duration
				: typeof currentSong?.audioDuration === "number" &&
						currentSong.audioDuration > 0
					? currentSong.audioDuration
					: 0;

		const state = this.connected
			? playback.isPlaying
				? "playing"
				: songId
					? "paused"
					: "idle"
			: "disconnected";
		const scope =
			this.mode === "local"
				? (this.localPlaylistName ?? this.localPlaylistId ?? "local")
				: (this.roomId ?? "room");
		const runtimeLabel =
			duration > 0
				? `${formatRuntimeClock(runtime)} / ${formatRuntimeClock(duration)}`
				: formatRuntimeClock(runtime);
		const text = title
			? `${state}: ${title}`
			: this.connected
				? `${this.mode}: idle`
				: `${this.mode}: offline`;
		const tooltip = [
			`State: ${state}`,
			`Mode: ${this.mode}`,
			`Scope: ${scope}`,
			title ? `Song: ${title}${artist ? ` - ${artist}` : ""}` : "Song: -",
			songId ? `Song ID: ${songId}` : "Song ID: -",
			`Runtime: ${runtimeLabel}`,
			`Queue: ${String(this.queue.length)}`,
			`Volume: ${Math.round((playback.volume || 0) * 100)}%`,
		].join("\n");
		const percentage =
			duration > 0
				? Math.round(Math.max(0, Math.min(1, runtime / duration)) * 100)
				: 0;

		return {
			text,
			tooltip,
			class: [
				"infi",
				`mode-${this.mode}`,
				`state-${state}`,
				this.connected ? "connected" : "disconnected",
			].join(" "),
			alt: state,
			percentage,
			mode: this.mode,
			connected: this.connected,
			roomId: this.roomId,
			localPlaylistId: this.localPlaylistId,
			localPlaylistName: this.localPlaylistName,
			songId,
			title,
			artist,
			queueLength: this.queue.length,
			runtime,
			duration,
			daemonHttpUrl: formatHttpOrigin(this.daemonHttpHost, this.daemonHttpPort),
		};
	}

	private async startLocalMode(payload: StartLocalPayload): Promise<void> {
		this.mode = "local";
		this.disconnect(true);
		this.stopLocalMode();

		this.serverUrl = payload.serverUrl;
		this.localPlaylistId = payload.playlistId;
		this.localPlaylistName = payload.playlistName ?? null;
		this.playlistKey = payload.playlistKey ?? null;
		this.connected = false;
		this.lastError = null;

		await this.refreshLocalQueue(true);
		this.localRefreshTimer = setInterval(() => {
			void this.refreshLocalQueue();
		}, LOCAL_QUEUE_REFRESH_MS);
		this.localHeartbeatTimer = setInterval(() => {
			void this.sendLocalHeartbeat();
		}, LOCAL_HEARTBEAT_MS);
		void this.sendLocalHeartbeat();
	}

	private stopLocalMode(): void {
		if (this.localRefreshTimer) {
			clearInterval(this.localRefreshTimer);
			this.localRefreshTimer = null;
		}
		if (this.localHeartbeatTimer) {
			clearInterval(this.localHeartbeatTimer);
			this.localHeartbeatTimer = null;
		}
		this.localPlaylistId = null;
		this.localPlaylistName = null;
		if (this.mode === "local") {
			this.ffplay.stop(true);
			this.connected = false;
			this.resetPlaybackState();
		}
	}

	private resetPlaybackState(): void {
		this.queue = [];
		this.currentSong = null;
		this.playback.currentSongId = null;
		this.playback.currentTime = 0;
		this.playback.duration = 0;
		this.playback.isPlaying = false;
		this.playback.volume = this.ffplay.getVolume();
		this.playback.isMuted = this.ffplay.isMuted();
	}

	private leaveRoomSession(): void {
		if (this.mode !== "room") return;
		this.disconnect(true);
		this.ffplay.stop(true);
		this.resetPlaybackState();
	}

	private leavePlaylistSession(): void {
		if (this.mode !== "local") return;
		this.stopLocalMode();
		this.playlistKey = null;
	}

	private clearSession(): void {
		this.stopLocalMode();
		this.disconnect(true);
		this.ffplay.stop(true);
		this.mode = "room";
		this.localPlaylistId = null;
		this.localPlaylistName = null;
		this.playlistKey = null;
		this.lastError = null;
		this.resetPlaybackState();
	}

	private async refreshLocalQueue(throwOnError = false): Promise<void> {
		if (
			this.mode !== "local" ||
			!this.serverUrl ||
			!this.localPlaylistId ||
			!this.shouldRun
		) {
			return;
		}

		try {
			const songs = await listSongsByPlaylist(
				this.serverUrl,
				this.localPlaylistId,
			);
			const playable = songs
				.filter((song) => song.status === "ready" && Boolean(song.audioUrl))
				.sort((a, b) => a.orderIndex - b.orderIndex)
				.map(toSongData);

			this.queue = playable;
			this.connected = true;
			this.lastError = null;
			this.reconcileLocalQueue(playable);
		} catch (error) {
			this.connected = false;
			this.lastError = error instanceof Error ? error.message : String(error);
			if (throwOnError) {
				throw error;
			}
		}
	}

	private reconcileLocalQueue(queue: SongData[]): void {
		const hasCurrent =
			this.currentSong !== null &&
			queue.some((song) => song.id === this.currentSong?.id);
		if (!hasCurrent) {
			this.currentSong = null;
			this.playback.currentSongId = null;
			this.playback.currentTime = 0;
			this.playback.duration = 0;
			this.playback.isPlaying = false;
		}

		if (!this.currentSong && queue.length > 0) {
			const seed = this.pickLocalStartSong(queue);
			if (seed) {
				this.playLocalSong(seed);
			}
		}
	}

	private pickLocalStartSong(queue: SongData[]): SongData | null {
		if (queue.length === 0) return null;
		const maxOrderIndex = queue[queue.length - 1]?.orderIndex ?? 0;
		const targetOrderIndex = maxOrderIndex - LOCAL_START_SONGS_FROM_END;
		const candidate = [...queue]
			.reverse()
			.find((song) => song.orderIndex <= targetOrderIndex);
		return candidate ?? queue[0] ?? null;
	}

	private playLocal(): void {
		if (this.mode !== "local") return;

		const snapshot = this.ffplay.getSnapshot();
		if (snapshot.songId && !snapshot.isPlaying) {
			this.ffplay.play();
			this.playback.isPlaying = true;
			return;
		}

		if (this.currentSong) {
			this.ffplay.play();
			this.playback.isPlaying = this.ffplay.isPlaying();
			return;
		}

		const seed = this.pickLocalStartSong(this.queue);
		if (!seed) {
			throw new Error("No local songs are ready yet.");
		}
		this.playLocalSong(seed);
	}

	private playLocalSong(song: SongData): void {
		if (!this.serverUrl || !song.audioUrl) return;
		this.currentSong = song;
		this.playback.currentSongId = song.id;
		this.playback.currentTime = 0;
		this.playback.duration = song.audioDuration ?? 0;
		this.playback.isPlaying = true;

		const url = resolveMediaUrl(this.serverUrl, song.audioUrl);
		this.ffplay.loadSong(song.id, url, undefined, 0);
		this.playback.volume = this.ffplay.getVolume();
		this.playback.isMuted = this.ffplay.isMuted();

		if (this.localPlaylistId) {
			void this.reportLocalPlaylistPosition(song.orderIndex);
		}
	}

	private selectLocalSong(songId: string): void {
		if (this.mode !== "local") return;
		const song = this.queue.find((entry) => entry.id === songId);
		if (!song?.audioUrl) {
			throw new Error(`Song "${songId}" is not ready for local playback.`);
		}
		void this.markCurrentLocalSongPlayed();
		this.playLocalSong(song);
	}

	private async handleLocalSongEnded(): Promise<void> {
		if (this.mode !== "local") return;
		await this.markCurrentLocalSongPlayed();
		const next = this.pickNextLocalSong();
		if (!next) {
			this.currentSong = null;
			this.playback.currentSongId = null;
			this.playback.currentTime = 0;
			this.playback.duration = 0;
			this.playback.isPlaying = false;
			return;
		}
		this.playLocalSong(next);
	}

	private pickNextLocalSong(): SongData | null {
		if (!this.currentSong) return this.pickLocalStartSong(this.queue);
		const currentOrder = this.currentSong.orderIndex;
		const ahead = this.queue.find((song) => song.orderIndex > currentOrder);
		if (ahead) return ahead;
		return null;
	}

	private async markCurrentLocalSongPlayed(): Promise<void> {
		if (
			this.mode !== "local" ||
			!this.serverUrl ||
			!this.currentSong ||
			!this.localPlaylistId
		) {
			return;
		}
		const song = this.currentSong;
		await Promise.allSettled([
			updateSongStatus(this.serverUrl, song.id, "played"),
			this.reportLocalPlaylistPosition(song.orderIndex),
		]);
	}

	private async reportLocalPlaylistPosition(orderIndex: number): Promise<void> {
		if (!this.serverUrl || !this.localPlaylistId) return;
		try {
			await updatePlaylistPosition(
				this.serverUrl,
				this.localPlaylistId,
				Math.max(0, orderIndex),
			);
		} catch {
			// Keep local playback resilient if position updates fail.
		}
	}

	private async sendLocalHeartbeat(): Promise<void> {
		if (
			this.mode !== "local" ||
			!this.serverUrl ||
			!this.localPlaylistId ||
			!this.shouldRun
		) {
			return;
		}
		try {
			await heartbeatPlaylist(this.serverUrl, this.localPlaylistId);
		} catch {
			// Heartbeat failures should not interrupt local playback.
		}
	}

	private syncLocalPlaybackSnapshot(): void {
		const snapshot = this.ffplay.getSnapshot();
		this.playback.currentSongId = snapshot.songId;
		this.playback.isPlaying = snapshot.isPlaying;
		this.playback.currentTime = snapshot.currentTime;
		this.playback.volume = snapshot.volume;
		this.playback.isMuted = snapshot.isMuted;
		if (this.currentSong) {
			this.playback.duration =
				this.currentSong.audioDuration ?? this.playback.duration;
		}
	}

	private waitUntilConnected(timeoutMs = 4000): Promise<void> {
		const ws = this.ws;
		if (this.connected && ws && ws.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}
		if (
			!ws ||
			ws.readyState === WebSocket.CLOSING ||
			ws.readyState === WebSocket.CLOSED
		) {
			return Promise.reject(new Error("Room socket is not connected"));
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
		this.stopLocalMode();
		this.disconnect(true);
		this.ffplay.destroy();
		await this.stopHttpServer();

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
