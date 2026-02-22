#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { InfiConfig, PlaybackMode } from "./config";
import { loadConfig, patchConfig } from "./config";
import { runDaemonRuntime } from "./daemon/runtime";
import {
	getPlaylistSession,
	listPlaylists,
	normalizeServerUrl,
} from "./lib/api";
import { getFlagNumber, getFlagString, hasFlag, parseArgs } from "./lib/flags";
import { pickFromFzf } from "./lib/fzf";
import {
	cleanupStaleRuntimeFiles,
	isDaemonResponsive,
	sendDaemonRequest,
} from "./lib/ipc";
import {
	CLI_ENTRY_PATH,
	CLI_MANPAGE_SOURCE_PATH,
	getLocalBinDir,
	getLocalManDir,
	getRuntimePaths,
	getSystemdUserDir,
	REPO_ROOT,
	TSX_LOADER_PATH,
} from "./lib/paths";
import {
	pickExistingRoom,
	pickSongFromQueue,
	resolvePlaylist,
	resolveRoom,
} from "./lib/room-resolution";

function printHelp(): void {
	console.log(`
Infinitune CLI controls a background daemon that owns playback.
Most commands talk to that daemon over IPC.

Modes:
  room   Join/sync a playlist session via server WebSocket (multi-device control).
  local  Play songs directly from a playlist on this machine (no room needed).

Common Workflows:
  First-time setup (guided):
    infi setup

  Use local mode by default:
    infi config --mode local
    infi play

  Use room mode by default:
    infi config --mode room --default-room <room-id>
    infi play

  One-off override:
    infi play --local
    infi play --room <room-id>
    infi play --playlist-key <playlist-key>

Playback Commands:
  infi play [--local] [--room <id>] [--playlist-key <key>] [--server <url>]
  infi stop
  infi skip
  infi thumb up|down
  infi volume up|down [--step <0..1>]
  infi mute
  infi song pick
  infi status
  infi doctor room

  Room Commands:
  infi room join --room <playlist-id>
  infi room pick
  infi room leave

Playlist Commands:
  infi playlist leave

Config Commands:
  infi config
  infi config --interactive
  infi config [--server <url>] [--device-name <name>] [--volume-step <0..1>]
             [--mode room|local] [--local] [--room-mode]
             [--default-room <id>] [--default-playlist-key <key>]
             [--device-token <token>] [--clear-token]
             [--daemon-host <host>] [--daemon-port <1..65535>]
             [--clear-room] [--clear-playlist]
  infi setup [--server <url>]
  infi clear

Daemon Commands:
  infi daemon start|stop|status|restart
  Daemon HTTP endpoints: /status /queue /waybar

Service Commands (systemd user unit):
  infi service install|uninstall|restart

Install Wrapper:
  infi install-cli
  infi install-man

Manual:
  infi man
`);
}

function requireOk(response: {
	ok: boolean;
	error?: string;
	data?: unknown;
}): unknown {
	if (!response.ok) {
		throw new Error(response.error ?? "Daemon request failed");
	}
	return response.data;
}

function toDisplayPercent(volume: number | undefined): string {
	if (typeof volume !== "number" || Number.isNaN(volume)) return "n/a";
	return `${Math.round(volume * 100)}%`;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Daemon returned malformed response payload.");
	}
	return value as Record<string, unknown>;
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

function printSongRuntimeStatus(data: Record<string, unknown>): {
	hasSongLine: boolean;
} {
	const playback = data.playback as Record<string, unknown> | undefined;
	const engine = data.engine as Record<string, unknown> | undefined;
	const currentSong = data.currentSong as Record<string, unknown> | undefined;

	const title =
		typeof currentSong?.title === "string" &&
		currentSong.title.trim().length > 0
			? currentSong.title.trim()
			: undefined;
	const artist =
		typeof currentSong?.artistName === "string" &&
		currentSong.artistName.trim().length > 0
			? currentSong.artistName.trim()
			: undefined;
	const songId =
		(typeof currentSong?.id === "string" && currentSong.id) ||
		(typeof playback?.currentSongId === "string" && playback.currentSongId) ||
		(typeof engine?.songId === "string" && engine.songId) ||
		undefined;

	if (title) {
		console.log(`Song: ${title}${artist ? ` — ${artist}` : ""}`);
	}
	if (songId) {
		console.log(`Song ID: ${songId}`);
	}

	const runtimeSec =
		asFiniteNumber(engine?.currentTime) ??
		asFiniteNumber(playback?.currentTime);
	const durationRaw =
		asFiniteNumber(playback?.duration) ??
		asFiniteNumber(currentSong?.audioDuration);
	const durationSec =
		typeof durationRaw === "number" && durationRaw > 0
			? durationRaw
			: undefined;

	if (runtimeSec !== undefined || durationSec !== undefined) {
		const runtimeText = formatRuntimeClock(runtimeSec ?? 0);
		let line = `Runtime: ${runtimeText}`;
		if (durationSec !== undefined) {
			line += ` / ${formatRuntimeClock(durationSec)}`;
			if (durationSec > 0 && runtimeSec !== undefined) {
				const ratio = Math.max(0, Math.min(1, runtimeSec / durationSec));
				line += ` (${Math.round(ratio * 100)}%)`;
			}
		}
		console.log(line);
	}

	return { hasSongLine: Boolean(title) };
}

function printRoomConnectionDiagnostics(data: Record<string, unknown>): void {
	const connectionState =
		typeof data.connectionState === "string" ? data.connectionState : undefined;
	if (connectionState) {
		console.log(`Connection State: ${connectionState}`);
	}

	if (typeof data.joinAcknowledged === "boolean") {
		console.log(`Join Acknowledged: ${data.joinAcknowledged ? "yes" : "no"}`);
	}

	if (typeof data.roomProtocolVersion === "number") {
		console.log(`Room Protocol: v${String(data.roomProtocolVersion)}`);
	}

	if (
		typeof data.reconnectAttempts === "number" &&
		data.reconnectAttempts > 0
	) {
		console.log(`Reconnect Attempts: ${String(data.reconnectAttempts)}`);
	}

	if (
		typeof data.lastDisconnectReason === "string" &&
		data.lastDisconnectReason.length > 0
	) {
		console.log(`Last Disconnect: ${data.lastDisconnectReason}`);
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function systemdQuote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function readLogTail(logPath: string, maxLines = 40): string | null {
	if (!fs.existsSync(logPath)) return null;
	try {
		const content = fs.readFileSync(logPath, "utf8");
		const lines = content
			.split("\n")
			.map((line) => line.trimEnd())
			.filter((line) => line.length > 0);
		if (lines.length === 0) return null;
		return lines.slice(-maxLines).join("\n");
	} catch {
		return null;
	}
}

function normalizeServerSetting(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("server cannot be empty");
	}
	if (/^https?:\/\//i.test(trimmed)) {
		return normalizeServerUrl(trimmed);
	}
	return normalizeServerUrl(`http://${trimmed}`);
}

function normalizeDaemonHostSetting(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("daemon-host cannot be empty");
	}
	return trimmed;
}

function normalizeDaemonPortSetting(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("daemon-port must be an integer between 1 and 65535");
	}
	return port;
}

function formatDaemonHttpUrl(host: string, port: number): string {
	const normalizedHost =
		host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `http://${normalizedHost}:${String(port)}`;
}

function resolveServerUrl(parsed: ReturnType<typeof parseArgs>): string {
	const config = loadConfig();
	const raw = getFlagString(parsed, "server") ?? config.serverUrl;
	return normalizeServerSetting(raw);
}

function redactToken(token: string | null): string {
	if (!token) return "-";
	if (token.length <= 12) return token;
	return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

function printConfig(config: InfiConfig): void {
	console.log("Current infi config:");
	console.log(`  serverUrl: ${config.serverUrl}`);
	console.log(`  deviceName: ${config.deviceName}`);
	console.log(`  playbackMode: ${config.playbackMode}`);
	console.log(`  volumeStep: ${config.volumeStep}`);
	console.log(`  defaultRoomId: ${config.defaultRoomId ?? "-"}`);
	console.log(`  defaultPlaylistKey: ${config.defaultPlaylistKey ?? "-"}`);
	console.log(`  deviceToken: ${redactToken(config.deviceToken)}`);
	console.log(`  daemonHttpHost: ${config.daemonHttpHost}`);
	console.log(`  daemonHttpPort: ${config.daemonHttpPort}`);
	console.log(
		`  daemonHttpUrl: ${formatDaemonHttpUrl(config.daemonHttpHost, config.daemonHttpPort)}`,
	);
}

function parsePlaybackMode(
	raw: string | undefined,
	current: PlaybackMode,
): PlaybackMode {
	if (!raw) return current;
	if (raw === "local" || raw === "room") return raw;
	throw new Error(`mode must be "local" or "room" (received "${raw}")`);
}

function resolvePlaybackMode(
	parsed: ReturnType<typeof parseArgs>,
	current: PlaybackMode,
): PlaybackMode {
	if (hasFlag(parsed, "local")) return "local";
	if (hasFlag(parsed, "room-mode")) return "room";
	const fromFlag = getFlagString(parsed, "mode");
	return parsePlaybackMode(fromFlag, current);
}

async function waitForDaemonReady(timeoutMs = 6000): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await isDaemonResponsive()) return true;
		await sleep(200);
	}
	return false;
}

async function waitForDaemonStopped(timeoutMs = 6000): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (!(await isDaemonResponsive())) return true;
		await sleep(200);
	}
	return false;
}

async function startDaemonProcess(flags: {
	serverUrl?: string;
	roomId?: string;
	playlistKey?: string;
	roomName?: string;
	deviceName?: string;
	deviceToken?: string;
	daemonHttpHost?: string;
	daemonHttpPort?: number;
}): Promise<void> {
	if (await isDaemonResponsive()) return;

	const runtimePaths = getRuntimePaths();
	fs.mkdirSync(runtimePaths.runtimeRoot, { recursive: true });
	cleanupStaleRuntimeFiles();

	const logFd = fs.openSync(runtimePaths.logPath, "a");
	const args = ["--import", TSX_LOADER_PATH, CLI_ENTRY_PATH, "daemon", "run"];
	if (flags.serverUrl) args.push("--server", flags.serverUrl);
	if (flags.roomId) args.push("--room", flags.roomId);
	if (flags.playlistKey) args.push("--playlist-key", flags.playlistKey);
	if (flags.roomName) args.push("--room-name", flags.roomName);
	if (flags.deviceName) args.push("--device-name", flags.deviceName);
	if (flags.deviceToken) args.push("--device-token", flags.deviceToken);
	if (flags.daemonHttpHost) args.push("--daemon-host", flags.daemonHttpHost);
	if (typeof flags.daemonHttpPort === "number") {
		args.push("--daemon-port", String(flags.daemonHttpPort));
	}

	const child = spawn(process.execPath, args, {
		detached: true,
		cwd: REPO_ROOT,
		stdio: ["ignore", logFd, logFd],
	});
	child.unref();
	fs.closeSync(logFd);

	const ready = await waitForDaemonReady();
	if (!ready) {
		const logTail = readLogTail(runtimePaths.logPath);
		const details = logTail ? `\nRecent daemon log:\n${logTail}` : "";
		throw new Error(
			`Daemon failed to start. Check log file: ${runtimePaths.logPath}${details}`,
		);
	}
}

async function ensureDaemonRunning(
	serverUrl: string,
	deviceName: string,
	config: InfiConfig,
): Promise<void> {
	if (await isDaemonResponsive()) return;
	await startDaemonProcess({
		serverUrl,
		deviceName,
		deviceToken: config.deviceToken ?? undefined,
		daemonHttpHost: config.daemonHttpHost,
		daemonHttpPort: config.daemonHttpPort,
	});
}

async function cmdDaemon(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "status";
	const serverUrl = resolveServerUrl(parsed);
	const config = loadConfig();
	const roomId = getFlagString(parsed, "room");
	const playlistKey = getFlagString(parsed, "playlist-key");
	const roomName = getFlagString(parsed, "room-name");
	const deviceName = getFlagString(parsed, "device-name") ?? config.deviceName;
	const deviceToken =
		getFlagString(parsed, "device-token", "token") ??
		config.deviceToken ??
		undefined;
	const daemonHttpHostRaw = getFlagString(parsed, "daemon-host", "http-host");
	const daemonHttpPortRaw = getFlagString(parsed, "daemon-port", "http-port");
	const daemonHttpHost =
		typeof daemonHttpHostRaw === "string"
			? normalizeDaemonHostSetting(daemonHttpHostRaw)
			: config.daemonHttpHost;
	const daemonHttpPort =
		typeof daemonHttpPortRaw === "string"
			? normalizeDaemonPortSetting(daemonHttpPortRaw)
			: config.daemonHttpPort;

	switch (sub) {
		case "run": {
			await runDaemonRuntime({
				serverUrl,
				roomId,
				playlistKey,
				roomName,
				deviceName,
				deviceToken,
				daemonHttpHost,
				daemonHttpPort,
			});
			return;
		}
		case "start": {
			if (await isDaemonResponsive()) {
				console.log("Daemon already running.");
				return;
			}
			await startDaemonProcess({
				serverUrl,
				roomId,
				playlistKey,
				roomName,
				deviceName,
				deviceToken,
				daemonHttpHost,
				daemonHttpPort,
			});
			console.log("Daemon started.");
			if (roomId) {
				const response = await sendDaemonRequest("joinRoom", {
					serverUrl,
					roomId,
					playlistKey,
					roomName,
					deviceName,
				});
				requireOk(response);
				console.log(`Joined room ${roomId}.`);
			}
			return;
		}
		case "restart": {
			if (await isDaemonResponsive()) {
				const shutdownResponse = await sendDaemonRequest("shutdown");
				requireOk(shutdownResponse);
				const stopped = await waitForDaemonStopped();
				if (!stopped) {
					throw new Error("Timed out waiting for daemon to stop.");
				}
			}
			await startDaemonProcess({
				serverUrl,
				roomId,
				playlistKey,
				roomName,
				deviceName,
				deviceToken,
				daemonHttpHost,
				daemonHttpPort,
			});
			console.log("Daemon restarted.");
			if (roomId) {
				const response = await sendDaemonRequest("joinRoom", {
					serverUrl,
					roomId,
					playlistKey,
					roomName,
					deviceName,
				});
				requireOk(response);
				console.log(`Joined room ${roomId}.`);
			}
			return;
		}
		case "stop": {
			if (!(await isDaemonResponsive())) {
				console.log("Daemon is not running.");
				return;
			}
			const response = await sendDaemonRequest("shutdown");
			requireOk(response);
			console.log("Daemon stopping.");
			return;
		}
		case "status": {
			if (!(await isDaemonResponsive())) {
				console.log("Daemon: not running");
				return;
			}
			const response = await sendDaemonRequest("status");
			const data = asRecord(requireOk(response));
			const mode =
				typeof data.mode === "string" && data.mode.length > 0
					? data.mode
					: "room";
			const roomDeviceMode =
				typeof data.roomDeviceMode === "string" ? data.roomDeviceMode : "-";
			const roomName =
				typeof data.roomName === "string" ? data.roomName : undefined;
			console.log(`Daemon: running (pid ${String(data.pid ?? "?")})`);
			console.log(`Mode: ${mode}`);
			console.log(`Connected: ${data.connected ? "yes" : "no"}`);
			console.log(
				`Room: ${
					typeof data.roomId === "string" && data.roomId.length > 0
						? `${data.roomId}${roomName ? ` (${roomName})` : ""}`
						: "-"
				}`,
			);
			console.log(
				`Assigned Playlist: ${String(data.assignedPlaylistId ?? "-")}`,
			);
			console.log(
				`Device Token: ${
					data.deviceTokenConfigured ? "configured" : "not set"
				}`,
			);
			if (mode === "room") {
				console.log(`Device Sync Mode: ${roomDeviceMode}`);
				printRoomConnectionDiagnostics(data);
			}
			if (mode === "local") {
				console.log(
					`Local Playlist: ${String(data.localPlaylistName ?? data.localPlaylistId ?? "-")}`,
				);
			}
			console.log(`Server: ${String(data.serverUrl ?? "-")}`);
			console.log(`Config Server: ${config.serverUrl}`);
			const daemonHttpUrl =
				typeof data.daemonHttpUrl === "string"
					? data.daemonHttpUrl
					: formatDaemonHttpUrl(daemonHttpHost, daemonHttpPort);
			console.log(`Daemon HTTP: ${daemonHttpUrl}`);
			console.log(
				`Config Daemon HTTP: ${formatDaemonHttpUrl(config.daemonHttpHost, config.daemonHttpPort)}`,
			);
			console.log(`Queue Length: ${String(data.queueLength ?? "0")}`);
			const playback = data.playback as Record<string, unknown> | undefined;
			const engine = data.engine as Record<string, unknown> | undefined;
			if (playback) {
				console.log(`Playing: ${playback.isPlaying ? "yes" : "no"}`);
				const volumeLabel =
					mode === "local" ? "Playback Volume" : "Room Volume";
				console.log(
					`${volumeLabel}: ${toDisplayPercent(
						typeof playback.volume === "number" ? playback.volume : undefined,
					)}`,
				);
			}
			if (engine) {
				console.log(
					`Local Volume: ${toDisplayPercent(
						typeof engine.volume === "number" ? engine.volume : undefined,
					)}`,
				);
			}
			printSongRuntimeStatus(data);
			if (typeof data.lastError === "string" && data.lastError.length > 0) {
				console.log(`Last Error: ${data.lastError}`);
			}
			return;
		}
		default:
			throw new Error(`Unknown daemon subcommand: ${sub}`);
	}
}

async function cmdPlay(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);
	const deviceName = getFlagString(parsed, "device-name") ?? config.deviceName;
	const playbackMode = resolvePlaybackMode(parsed, config.playbackMode);

	if (playbackMode === "local" && getFlagString(parsed, "room")) {
		throw new Error("--room cannot be used with local playback.");
	}

	await ensureDaemonRunning(serverUrl, deviceName, config);

	if (playbackMode === "local") {
		const playlist = await resolvePlaylist(serverUrl, {
			explicitPlaylistKey: getFlagString(parsed, "playlist-key"),
			defaultPlaylistKey: config.defaultPlaylistKey,
			interactivePlaylist: true,
		});

		const startLocalResponse = await sendDaemonRequest("startLocal", {
			serverUrl,
			playlistId: playlist.id,
			playlistKey: playlist.playlistKey ?? undefined,
			playlistName: playlist.name,
			deviceName,
		});
		requireOk(startLocalResponse);

		const playResponse = await sendDaemonRequest("play");
		requireOk(playResponse);

		patchConfig({
			serverUrl,
			deviceName,
			defaultPlaylistKey: playlist.playlistKey ?? null,
		});

		console.log(
			`Playing locally from playlist ${playlist.playlistKey ?? playlist.id} (${playlist.name}).`,
		);
		return;
	}

	const explicitRoomId = getFlagString(parsed, "room");
	const explicitPlaylistKey = getFlagString(parsed, "playlist-key");
	if (!explicitRoomId && !explicitPlaylistKey) {
		const statusResponse = await sendDaemonRequest("status");
		const status = asRecord(requireOk(statusResponse));
		const daemonMode = typeof status.mode === "string" ? status.mode : "room";
		const joinedRoomId =
			typeof status.roomId === "string" && status.roomId.length > 0
				? status.roomId
				: null;
		const assignedPlaylistId =
			typeof status.assignedPlaylistId === "string" &&
			status.assignedPlaylistId.length > 0
				? status.assignedPlaylistId
				: null;

		if (daemonMode === "room" && joinedRoomId) {
			const playResponse = await sendDaemonRequest("play");
			requireOk(playResponse);
			console.log(`Playing in room ${joinedRoomId}.`);
			return;
		}

		if (daemonMode === "room" && assignedPlaylistId) {
			const joinResponse = await sendDaemonRequest("joinRoom", {
				serverUrl,
				roomId: assignedPlaylistId,
				deviceName,
			});
			requireOk(joinResponse);
			const playResponse = await sendDaemonRequest("play");
			requireOk(playResponse);
			patchConfig({
				serverUrl,
				deviceName,
				defaultRoomId: assignedPlaylistId,
			});
			console.log(`Playing assigned playlist session ${assignedPlaylistId}.`);
			return;
		}
	}

	const resolved = await resolveRoom(serverUrl, {
		explicitRoomId,
		explicitPlaylistKey,
		defaultRoomId: config.defaultRoomId,
		defaultPlaylistKey: config.defaultPlaylistKey,
		interactivePlaylist: true,
	});

	const joinResponse = await sendDaemonRequest("joinRoom", {
		serverUrl,
		roomId: resolved.room.id,
		playlistKey: resolved.room.playlistKey,
		roomName: resolved.room.name,
		deviceName,
	});
	requireOk(joinResponse);

	const playResponse = await sendDaemonRequest("play");
	requireOk(playResponse);

	patchConfig({
		serverUrl,
		deviceName,
		defaultRoomId: resolved.room.id,
		defaultPlaylistKey: resolved.room.playlistKey,
	});

	if (resolved.created) {
		console.log(
			`Created room ${resolved.room.id} for playlist ${resolved.room.playlistKey}.`,
		);
	}
	console.log(`Playing in room ${resolved.room.id} (${resolved.room.name}).`);
}

async function cmdStop(): Promise<void> {
	const response = await sendDaemonRequest("pause");
	requireOk(response);
	console.log("Playback paused.");
}

async function cmdSkip(): Promise<void> {
	const response = await sendDaemonRequest("skip");
	requireOk(response);
	console.log("Skipped to next song.");
}

async function cmdVolume(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const direction = parsed.positionals[0];
	if (direction !== "up" && direction !== "down") {
		throw new Error("Usage: infi volume up|down [--step 0.05]");
	}
	const config = loadConfig();
	const step = getFlagNumber(parsed, config.volumeStep, "step");
	const delta = direction === "up" ? Math.abs(step) : -Math.abs(step);
	const response = await sendDaemonRequest("volumeDelta", { delta });
	const data = requireOk(response) as { volume?: number; scope?: string };
	const label = data.scope === "device" ? "Local Volume" : "Volume";
	console.log(`${label}: ${toDisplayPercent(data.volume)}`);
}

async function cmdMute(): Promise<void> {
	const response = await sendDaemonRequest("toggleMute");
	requireOk(response);
	console.log("Toggled mute.");
}

async function cmdThumb(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const direction = parsed.positionals[0];
	if (direction !== "up" && direction !== "down") {
		throw new Error("Usage: infi thumb up|down");
	}
	const response = await sendDaemonRequest("rate", { rating: direction });
	const data = requireOk(response) as {
		songId?: string;
		title?: string | null;
	};
	const label =
		typeof data.title === "string" && data.title.trim().length > 0
			? data.title.trim()
			: (data.songId ?? "current song");
	console.log(
		`Thumbs ${direction} sent for ${label}. Repeating the same vote toggles it off.`,
	);
}

function printRoomSubcommandHelp(): void {
	console.log("Room commands (playlist sessions):");
	console.log("  infi room join --room <playlist-id>");
	console.log("  infi room pick");
	console.log("  infi room leave");
	console.log("  infi room help");
}

async function cmdRoom(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0];
	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);
	const deviceName = getFlagString(parsed, "device-name") ?? config.deviceName;
	if (!sub || sub === "help" || sub === "--help") {
		printRoomSubcommandHelp();
		return;
	}

	if (sub === "leave") {
		if (!(await isDaemonResponsive())) {
			console.log("Daemon is not running. No room to leave.");
			return;
		}
		const statusResponse = await sendDaemonRequest("status");
		const status = requireOk(statusResponse) as Record<string, unknown>;
		const mode = typeof status.mode === "string" ? status.mode : "room";
		if (mode !== "room") {
			console.log("Daemon is not in room mode. No room session to leave.");
			return;
		}
		const roomId =
			typeof status.roomId === "string" && status.roomId.length > 0
				? status.roomId
				: null;
		if (!roomId) {
			console.log("No active room session.");
			return;
		}
		const response = await sendDaemonRequest("leaveRoom");
		requireOk(response);
		const verifyResponse = await sendDaemonRequest("status");
		const verifyStatus = requireOk(verifyResponse) as Record<string, unknown>;
		const remainingRoomId =
			typeof verifyStatus.roomId === "string" && verifyStatus.roomId.length > 0
				? verifyStatus.roomId
				: null;
		if (remainingRoomId) {
			throw new Error(
				`Daemon did not leave room session (still in ${remainingRoomId}). Run \`infi daemon restart\` and retry.`,
			);
		}
		console.log(`Left room ${roomId}.`);
		return;
	}

	await ensureDaemonRunning(serverUrl, deviceName, config);

	switch (sub) {
		case "join": {
			const roomId = getFlagString(parsed, "room");
			if (!roomId) {
				throw new Error("Usage: infi room join --room <playlist-id>");
			}
			const response = await sendDaemonRequest("joinRoom", {
				serverUrl,
				roomId,
				deviceName,
			});
			requireOk(response);
			patchConfig({
				serverUrl,
				deviceName,
				defaultRoomId: roomId,
			});
			console.log(`Joined room ${roomId}.`);
			return;
		}
		case "pick": {
			const room = await pickExistingRoom(serverUrl);
			const response = await sendDaemonRequest("joinRoom", {
				serverUrl,
				roomId: room.id,
				playlistKey: room.playlistKey,
				roomName: room.name,
				deviceName,
			});
			requireOk(response);
			patchConfig({
				serverUrl,
				deviceName,
				defaultRoomId: room.id,
				defaultPlaylistKey: room.playlistKey,
			});
			console.log(`Joined room ${room.id} (${room.name}).`);
			return;
		}
		default:
			throw new Error(`Unknown room subcommand: ${sub}`);
	}
}

async function cmdPlaylist(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "leave";
	switch (sub) {
		case "leave": {
			if (!(await isDaemonResponsive())) {
				console.log("Daemon is not running. No local playlist to leave.");
				return;
			}
			const statusResponse = await sendDaemonRequest("status");
			const status = requireOk(statusResponse) as Record<string, unknown>;
			const mode = typeof status.mode === "string" ? status.mode : "room";
			if (mode !== "local") {
				console.log(
					"Daemon is not in local mode. No playlist session to leave.",
				);
				return;
			}
			const playlistName =
				typeof status.localPlaylistName === "string" &&
				status.localPlaylistName.length > 0
					? status.localPlaylistName
					: null;
			const playlistId =
				typeof status.localPlaylistId === "string" &&
				status.localPlaylistId.length > 0
					? status.localPlaylistId
					: null;
			const response = await sendDaemonRequest("leavePlaylist");
			requireOk(response);
			const verifyResponse = await sendDaemonRequest("status");
			const verifyStatus = requireOk(verifyResponse) as Record<string, unknown>;
			const verifyMode =
				typeof verifyStatus.mode === "string" ? verifyStatus.mode : "room";
			const remainingPlaylist =
				typeof verifyStatus.localPlaylistName === "string" &&
				verifyStatus.localPlaylistName.length > 0
					? verifyStatus.localPlaylistName
					: typeof verifyStatus.localPlaylistId === "string" &&
							verifyStatus.localPlaylistId.length > 0
						? verifyStatus.localPlaylistId
						: null;
			if (verifyMode === "local" && remainingPlaylist) {
				throw new Error(
					`Daemon did not leave local playlist (still using ${remainingPlaylist}). Run \`infi daemon restart\` and retry.`,
				);
			}
			console.log(
				`Left local playlist ${playlistName ?? playlistId ?? "(unknown)"}.`,
			);
			return;
		}
		default:
			throw new Error(`Unknown playlist subcommand: ${sub}`);
	}
}

async function cmdSong(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "pick";
	if (sub !== "pick") {
		throw new Error(`Unknown song subcommand: ${sub}`);
	}

	const response = await sendDaemonRequest("queue");
	const queue = requireOk(response) as Array<{
		id: string;
		title?: string;
		artistName?: string;
		status: string;
	}>;
	if (queue.length === 0) {
		const statusResponse = await sendDaemonRequest("status");
		const status = requireOk(statusResponse) as Record<string, unknown>;
		const connected = Boolean(status.connected);
		if (connected) {
			console.log("No songs available to pick yet (queue is empty).");
			return;
		}
		const roomId =
			typeof status.roomId === "string" && status.roomId.length > 0
				? status.roomId
				: null;
		console.log(
			`Not connected to a room${
				roomId ? ` (${roomId})` : ""
			}. Run \`infi play\`, \`infi play --local\`, or \`infi room join --room <id>\`.`,
		);
		return;
	}
	const songId = pickSongFromQueue(queue);
	const selectResponse = await sendDaemonRequest("selectSong", { songId });
	requireOk(selectResponse);
	console.log(`Selected song ${songId}.`);
}

async function cmdStatus(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);

	if (!(await isDaemonResponsive())) {
		console.log("Daemon: not running");
		return;
	}

	const daemonResponse = await sendDaemonRequest("status");
	const daemonData = asRecord(requireOk(daemonResponse));
	const mode =
		typeof daemonData.mode === "string" && daemonData.mode.length > 0
			? daemonData.mode
			: "room";
	const roomDeviceMode =
		typeof daemonData.roomDeviceMode === "string"
			? daemonData.roomDeviceMode
			: undefined;
	const roomId =
		typeof daemonData.roomId === "string" ? daemonData.roomId : undefined;
	const roomName =
		typeof daemonData.roomName === "string" ? daemonData.roomName : undefined;
	const assignedPlaylistId =
		typeof daemonData.assignedPlaylistId === "string"
			? daemonData.assignedPlaylistId
			: undefined;
	const deviceTokenConfigured =
		typeof daemonData.deviceTokenConfigured === "boolean"
			? daemonData.deviceTokenConfigured
			: false;
	const localPlaylistName =
		typeof daemonData.localPlaylistName === "string"
			? daemonData.localPlaylistName
			: undefined;
	const localPlaylistId =
		typeof daemonData.localPlaylistId === "string"
			? daemonData.localPlaylistId
			: undefined;

	console.log(`Daemon: running (pid ${String(daemonData.pid ?? "?")})`);
	console.log(`Mode: ${mode}`);
	console.log(`Connected: ${daemonData.connected ? "yes" : "no"}`);
	console.log(
		`Room: ${roomId ? `${roomId}${roomName ? ` (${roomName})` : ""}` : "-"}`,
	);
	console.log(`Assigned Playlist: ${assignedPlaylistId ?? "-"}`);
	console.log(
		`Device Token: ${deviceTokenConfigured ? "configured" : "not set"}`,
	);
	if (mode === "room") {
		console.log(`Device Sync Mode: ${roomDeviceMode ?? "-"}`);
		printRoomConnectionDiagnostics(daemonData);
	}
	if (mode === "local") {
		console.log(
			`Local Playlist: ${localPlaylistName ?? localPlaylistId ?? "-"}`,
		);
	}
	console.log(`Server: ${String(daemonData.serverUrl ?? serverUrl)}`);
	console.log(`Config Server: ${config.serverUrl}`);
	const daemonHttpUrl =
		typeof daemonData.daemonHttpUrl === "string"
			? daemonData.daemonHttpUrl
			: formatDaemonHttpUrl(config.daemonHttpHost, config.daemonHttpPort);
	console.log(`Daemon HTTP: ${daemonHttpUrl}`);
	console.log(
		`Config Daemon HTTP: ${formatDaemonHttpUrl(config.daemonHttpHost, config.daemonHttpPort)}`,
	);
	console.log(`Queue Length: ${String(daemonData.queueLength ?? "0")}`);

	const playback = daemonData.playback as Record<string, unknown> | undefined;
	const engine = daemonData.engine as Record<string, unknown> | undefined;
	if (playback) {
		console.log(`Playing: ${playback.isPlaying ? "yes" : "no"}`);
		const volumeLabel = mode === "local" ? "Playback Volume" : "Room Volume";
		console.log(
			`${volumeLabel}: ${toDisplayPercent(
				typeof playback.volume === "number" ? playback.volume : undefined,
			)}`,
		);
	}
	if (engine) {
		console.log(
			`Local Volume: ${toDisplayPercent(
				typeof engine.volume === "number" ? engine.volume : undefined,
			)}`,
		);
	}
	const songStatus = printSongRuntimeStatus(daemonData);
	if (
		typeof daemonData.lastError === "string" &&
		daemonData.lastError.length > 0
	) {
		console.log(`Last Error: ${daemonData.lastError}`);
	}

	if (mode === "room" && roomId && !songStatus.hasSongLine) {
		try {
			const session = await getPlaylistSession(serverUrl, roomId, {
				deviceToken: config.deviceToken ?? undefined,
			});
			if (session.currentSong?.title) {
				console.log(`Now Playing: ${session.currentSong.title}`);
				if (session.currentSong.artistName) {
					console.log(`Artist: ${session.currentSong.artistName}`);
				}
			}
		} catch {
			// Keep status output usable even if server query fails.
		}
	}
}

async function cmdDoctor(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const target = parsed.positionals[0] ?? "room";
	if (target !== "room") {
		throw new Error("Usage: infi doctor room [--server <url>]");
	}

	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);
	console.log("Doctor: room");
	console.log(`Config Server: ${config.serverUrl}`);
	console.log(`Target Server: ${serverUrl}`);

	if (!(await isDaemonResponsive())) {
		console.log("Daemon: not running");
		console.log("Result: FAIL (start daemon with `infi daemon start` first)");
		return;
	}

	const daemonResponse = await sendDaemonRequest("status");
	const daemonData = asRecord(requireOk(daemonResponse));
	const mode =
		typeof daemonData.mode === "string" && daemonData.mode.length > 0
			? daemonData.mode
			: "room";
	const roomId =
		typeof daemonData.roomId === "string" && daemonData.roomId.length > 0
			? daemonData.roomId
			: null;
	const connected = Boolean(daemonData.connected);
	const connectionState =
		typeof daemonData.connectionState === "string"
			? daemonData.connectionState
			: "unknown";
	const daemonServer =
		typeof daemonData.serverUrl === "string" ? daemonData.serverUrl : null;

	let issues = 0;
	const warn = (text: string) => {
		issues += 1;
		console.log(`- WARN: ${text}`);
	};
	const ok = (text: string) => {
		console.log(`- OK: ${text}`);
	};

	if (mode !== "room") {
		warn(`daemon mode is "${mode}" (room checks are limited)`);
	} else {
		ok("daemon mode is room");
	}

	if (daemonServer && daemonServer !== serverUrl) {
		warn(
			`daemon server (${daemonServer}) differs from target server (${serverUrl})`,
		);
	} else if (daemonServer) {
		ok(`daemon server matches target (${daemonServer})`);
	} else {
		warn("daemon has no server URL configured");
	}

	if (!roomId) {
		warn("daemon is not joined to a room");
	} else {
		ok(`daemon room is ${roomId}`);
	}

	if (connected && connectionState === "connected") {
		ok("room websocket is connected");
	} else {
		warn(`room websocket is ${connectionState}`);
	}

	if (mode === "room") {
		if (typeof daemonData.joinAcknowledged === "boolean") {
			if (daemonData.joinAcknowledged) {
				ok("join acknowledgment received");
			} else {
				warn("join acknowledgment missing");
			}
		}
		if (typeof daemonData.roomProtocolVersion === "number") {
			ok(`room protocol version v${String(daemonData.roomProtocolVersion)}`);
		}
		if (
			typeof daemonData.lastDisconnectReason === "string" &&
			daemonData.lastDisconnectReason.length > 0
		) {
			warn(`last disconnect reason: ${daemonData.lastDisconnectReason}`);
		}
	}

	if (roomId) {
		try {
			await getPlaylistSession(serverUrl, roomId, {
				deviceToken: config.deviceToken ?? undefined,
			});
			ok("playlist session exists on target server");
		} catch (error) {
			warn(
				`unable to resolve playlist session on target server (${
					error instanceof Error ? error.message : String(error)
				})`,
			);
		}

		try {
			const session = await getPlaylistSession(serverUrl, roomId, {
				deviceToken: config.deviceToken ?? undefined,
			});
			if (session.currentSong?.title) {
				ok(
					`playlist session responds (now playing: ${session.currentSong.title})`,
				);
			} else {
				ok("playlist session responds");
			}
		} catch (error) {
			warn(
				`playlist session endpoint failed (${
					error instanceof Error ? error.message : String(error)
				})`,
			);
		}
	}

	if (issues === 0) {
		console.log("Result: PASS");
		return;
	}
	console.log(
		`Result: WARN (${String(issues)} issue${issues === 1 ? "" : "s"})`,
	);
}

async function promptWithDefault(
	rl: ReturnType<typeof createInterface>,
	question: string,
	defaultValue: string,
): Promise<string> {
	const answer = await rl.question(`${question} [${defaultValue}]: `);
	const trimmed = answer.trim();
	return trimmed.length > 0 ? trimmed : defaultValue;
}

async function pickModeInteractive(
	current: PlaybackMode,
	rl: ReturnType<typeof createInterface>,
): Promise<PlaybackMode> {
	const options = [
		"room\tRoom playback (shared control + sync)",
		"local\tLocal playback (no room)",
	];
	try {
		const picked = pickFromFzf(options, {
			prompt: "mode",
			header: "mode | description",
			delimiter: "\t",
			withNth: "1..",
		});
		if (!picked) return current;
		const mode = picked.split("\t")[0];
		return mode === "local" ? "local" : "room";
	} catch {
		const raw = await promptWithDefault(
			rl,
			"Playback mode (room/local)",
			current,
		);
		return parsePlaybackMode(raw, current);
	}
}

async function pickDefaultPlaylistKeyInteractive(
	serverUrl: string,
	current: string | null,
): Promise<string | null> {
	let playlists: Awaited<ReturnType<typeof listPlaylists>>;
	try {
		playlists = await listPlaylists(serverUrl);
	} catch {
		return current;
	}

	const keyable = playlists
		.filter((playlist) => typeof playlist.playlistKey === "string")
		.sort((a, b) => b.createdAt - a.createdAt);
	if (keyable.length === 0) {
		return current;
	}

	const lines = [
		"-\t(no default playlist)",
		...keyable.map((playlist) => {
			const name = playlist.name.trim() || "(untitled playlist)";
			return `${playlist.playlistKey}\t${name}`;
		}),
	];

	try {
		const picked = pickFromFzf(lines, {
			prompt: "playlist",
			header: "playlistKey | name",
			delimiter: "\t",
			withNth: "1..",
		});
		if (!picked) return current;
		const key = picked.split("\t")[0];
		return key === "-" ? null : key;
	} catch {
		return current;
	}
}

async function runConfigWizard(
	current: InfiConfig,
): Promise<Partial<InfiConfig>> {
	const rl = createInterface({ input, output });
	try {
		const patch: Partial<InfiConfig> = {};
		const serverInput = await promptWithDefault(
			rl,
			"Server URL",
			current.serverUrl,
		);
		patch.serverUrl = normalizeServerSetting(serverInput);

		const deviceInput = await promptWithDefault(
			rl,
			"Device Name",
			current.deviceName,
		);
		if (!deviceInput.trim()) {
			throw new Error("device-name cannot be empty");
		}
		patch.deviceName = deviceInput.trim();

		const daemonHostInput = await promptWithDefault(
			rl,
			"Daemon HTTP Host",
			current.daemonHttpHost,
		);
		patch.daemonHttpHost = normalizeDaemonHostSetting(daemonHostInput);

		const daemonPortInput = await promptWithDefault(
			rl,
			"Daemon HTTP Port",
			String(current.daemonHttpPort),
		);
		patch.daemonHttpPort = normalizeDaemonPortSetting(daemonPortInput);

		const volumeInput = await promptWithDefault(
			rl,
			"Volume Step (0..1)",
			String(current.volumeStep),
		);
		const volumeStep = Number(volumeInput);
		if (!Number.isFinite(volumeStep) || volumeStep <= 0 || volumeStep > 1) {
			throw new Error("volume-step must be a number between 0 and 1");
		}
		patch.volumeStep = volumeStep;

		patch.playbackMode = await pickModeInteractive(current.playbackMode, rl);
		patch.defaultPlaylistKey = await pickDefaultPlaylistKeyInteractive(
			patch.serverUrl,
			current.defaultPlaylistKey,
		);

		return patch;
	} finally {
		rl.close();
	}
}

async function cmdConfig(args: string[], setupMode = false): Promise<void> {
	const parsed = parseArgs(args);
	const current = loadConfig();
	const interactive =
		hasFlag(parsed, "interactive", "wizard") ||
		(setupMode && parsed.positionals.length === 0 && parsed.flags.size === 0);

	const server = getFlagString(parsed, "server");
	const deviceName = getFlagString(parsed, "device-name", "device");
	const deviceTokenRaw = getFlagString(parsed, "device-token", "token");
	const volumeStepRaw = getFlagString(parsed, "volume-step", "step");
	const playbackModeRaw = getFlagString(parsed, "mode");
	const daemonHttpHostRaw = getFlagString(parsed, "daemon-host", "http-host");
	const daemonHttpPortRaw = getFlagString(parsed, "daemon-port", "http-port");
	const defaultRoomId = getFlagString(parsed, "default-room", "room");
	const defaultPlaylistKey = getFlagString(
		parsed,
		"default-playlist-key",
		"playlist-key",
	);
	const localFlag = hasFlag(parsed, "local");
	const roomModeFlag = hasFlag(parsed, "room-mode");
	const clearRoom = parsed.flags.has("clear-room");
	const clearPlaylist = parsed.flags.has("clear-playlist");
	const clearToken = parsed.flags.has("clear-token");

	const hasUpdates =
		interactive ||
		typeof server === "string" ||
		typeof deviceName === "string" ||
		typeof deviceTokenRaw === "string" ||
		typeof volumeStepRaw === "string" ||
		typeof playbackModeRaw === "string" ||
		typeof daemonHttpHostRaw === "string" ||
		typeof daemonHttpPortRaw === "string" ||
		localFlag ||
		roomModeFlag ||
		typeof defaultRoomId === "string" ||
		typeof defaultPlaylistKey === "string" ||
		clearRoom ||
		clearPlaylist ||
		clearToken;

	if (!hasUpdates) {
		if (setupMode) {
			console.log("Usage: infi setup --server <url>");
			console.log(
				"Optional: --device-name <name> --device-token <token> --volume-step <n> --mode room|local --daemon-host <host> --daemon-port <port>",
			);
			return;
		}
		printConfig(current);
		return;
	}

	const patch: Partial<InfiConfig> = interactive
		? await runConfigWizard(current)
		: {};

	if (typeof server === "string") {
		patch.serverUrl = normalizeServerSetting(server);
	}
	if (typeof deviceName === "string") {
		const trimmed = deviceName.trim();
		if (!trimmed) {
			throw new Error("device-name cannot be empty");
		}
		patch.deviceName = trimmed;
	}
	if (typeof deviceTokenRaw === "string") {
		const trimmed = deviceTokenRaw.trim();
		if (!trimmed) {
			throw new Error("device-token cannot be empty");
		}
		patch.deviceToken = trimmed;
	}
	if (typeof volumeStepRaw === "string") {
		const value = Number(volumeStepRaw);
		if (!Number.isFinite(value) || value <= 0 || value > 1) {
			throw new Error("volume-step must be a number between 0 and 1");
		}
		patch.volumeStep = value;
	}
	if (typeof playbackModeRaw === "string") {
		patch.playbackMode = parsePlaybackMode(
			playbackModeRaw,
			current.playbackMode,
		);
	}
	if (typeof daemonHttpHostRaw === "string") {
		patch.daemonHttpHost = normalizeDaemonHostSetting(daemonHttpHostRaw);
	}
	if (typeof daemonHttpPortRaw === "string") {
		patch.daemonHttpPort = normalizeDaemonPortSetting(daemonHttpPortRaw);
	}
	if (localFlag) {
		patch.playbackMode = "local";
	}
	if (roomModeFlag) {
		patch.playbackMode = "room";
	}
	if (typeof defaultRoomId === "string") {
		patch.defaultRoomId = defaultRoomId.trim() || null;
	}
	if (typeof defaultPlaylistKey === "string") {
		patch.defaultPlaylistKey = defaultPlaylistKey.trim() || null;
	}
	if (clearRoom) {
		patch.defaultRoomId = null;
	}
	if (clearPlaylist) {
		patch.defaultPlaylistKey = null;
	}
	if (clearToken) {
		patch.deviceToken = null;
	}

	const next = patchConfig(patch, current);
	console.log("Updated infi config.");
	printConfig(next);

	if (await isDaemonResponsive()) {
		const daemonPatch: Record<string, unknown> = {};
		if (typeof patch.serverUrl === "string") {
			daemonPatch.serverUrl = patch.serverUrl;
		}
		if (typeof patch.deviceName === "string") {
			daemonPatch.deviceName = patch.deviceName;
		}
		if ("deviceToken" in patch) {
			daemonPatch.deviceToken = patch.deviceToken;
		}
		if (typeof patch.playbackMode === "string") {
			daemonPatch.playbackMode = patch.playbackMode;
		}
		if (typeof patch.daemonHttpHost === "string") {
			daemonPatch.daemonHttpHost = patch.daemonHttpHost;
		}
		if (typeof patch.daemonHttpPort === "number") {
			daemonPatch.daemonHttpPort = patch.daemonHttpPort;
		}
		if (Object.keys(daemonPatch).length > 0) {
			try {
				const response = await sendDaemonRequest("configure", daemonPatch);
				requireOk(response);
				console.log("Applied config changes to running daemon.");
			} catch (error) {
				console.log(
					`Warning: failed to apply config to daemon (${
						error instanceof Error ? error.message : String(error)
					}). Run \`infi daemon restart\` if needed.`,
				);
			}
		}
	}
}

async function cmdClear(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	if (parsed.positionals.length > 0 || parsed.flags.size > 0) {
		throw new Error("Usage: infi clear");
	}

	const next = patchConfig({
		playbackMode: "room",
		defaultRoomId: null,
		defaultPlaylistKey: null,
	});
	console.log("Cleared non-general config fields.");
	printConfig(next);

	if (!(await isDaemonResponsive())) {
		console.log("Daemon is not running; runtime session already clear.");
		return;
	}

	try {
		const response = await sendDaemonRequest("clearSession");
		requireOk(response);
		const statusResponse = await sendDaemonRequest("status");
		const status = requireOk(statusResponse) as Record<string, unknown>;
		const roomId =
			typeof status.roomId === "string" && status.roomId.length > 0
				? status.roomId
				: null;
		const localPlaylist =
			typeof status.localPlaylistName === "string" &&
			status.localPlaylistName.length > 0
				? status.localPlaylistName
				: typeof status.localPlaylistId === "string" &&
						status.localPlaylistId.length > 0
					? status.localPlaylistId
					: null;
		if (roomId || localPlaylist) {
			console.log(
				`Warning: daemon session still active (${
					roomId ? `room ${roomId}` : `playlist ${localPlaylist}`
				}). Run \`infi daemon restart\` if needed.`,
			);
			return;
		}
		console.log("Cleared active daemon session.");
	} catch (error) {
		console.log(
			`Warning: failed to clear daemon session (${
				error instanceof Error ? error.message : String(error)
			}). Run \`infi daemon restart\` if needed.`,
		);
	}
}

function writeExecutableScript(targetPath: string): void {
	const script = `#!/usr/bin/env bash
set -euo pipefail
exec ${shellQuote(process.execPath)} --import ${shellQuote(TSX_LOADER_PATH)} ${shellQuote(CLI_ENTRY_PATH)} "$@"
`;
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, script, { mode: 0o755 });
	fs.chmodSync(targetPath, 0o755);
}

function systemctlUser(args: string[]): void {
	const result = spawnSync("systemctl", ["--user", ...args], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(
			result.stderr.trim() || `systemctl --user ${args.join(" ")} failed`,
		);
	}
}

async function cmdService(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "install";
	const unitName = "infinitune-daemon.service";
	const unitDir = getSystemdUserDir();
	const unitPath = path.join(unitDir, unitName);
	const serverUrl = resolveServerUrl(parsed);
	const config = loadConfig();
	const deviceToken =
		getFlagString(parsed, "device-token", "token") ?? config.deviceToken;

	switch (sub) {
		case "install": {
			fs.mkdirSync(unitDir, { recursive: true });
			const tokenArg = deviceToken
				? ` --device-token ${systemdQuote(deviceToken)}`
				: "";
			const unitFile = `[Unit]
Description=Infinitune Terminal Daemon
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(REPO_ROOT)}
ExecStart=${systemdQuote(process.execPath)} --import ${systemdQuote(TSX_LOADER_PATH)} ${systemdQuote(CLI_ENTRY_PATH)} daemon run --server ${systemdQuote(serverUrl)}${tokenArg}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
			fs.writeFileSync(unitPath, unitFile, "utf8");
			systemctlUser(["daemon-reload"]);
			systemctlUser(["enable", "--now", unitName]);
			console.log(`Installed and started ${unitName}.`);
			return;
		}
		case "uninstall": {
			try {
				systemctlUser(["disable", "--now", unitName]);
			} catch {
				// Service may not be enabled.
			}
			if (fs.existsSync(unitPath)) {
				fs.unlinkSync(unitPath);
			}
			systemctlUser(["daemon-reload"]);
			console.log(`Uninstalled ${unitName}.`);
			return;
		}
		case "restart": {
			systemctlUser(["restart", unitName]);
			console.log(`Restarted ${unitName}.`);
			return;
		}
		default:
			throw new Error(`Unknown service subcommand: ${sub}`);
	}
}

async function cmdInstallCli(): Promise<void> {
	const target = path.join(getLocalBinDir(), "infi");
	writeExecutableScript(target);
	console.log(`Installed command wrapper: ${target}`);
	console.log("Ensure ~/.local/bin is in your PATH.");
}

function resolveInstalledManpagePath(): string {
	return path.join(getLocalManDir(), "man1", "infi.1");
}

async function cmdInstallMan(): Promise<void> {
	if (!fs.existsSync(CLI_MANPAGE_SOURCE_PATH)) {
		throw new Error(`Man page source not found: ${CLI_MANPAGE_SOURCE_PATH}`);
	}

	const targetPath = resolveInstalledManpagePath();
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.copyFileSync(CLI_MANPAGE_SOURCE_PATH, targetPath);

	console.log(`Installed man page: ${targetPath}`);
	console.log(
		'If needed, run: export MANPATH="$HOME/.local/share/man:$MANPATH"',
	);
	console.log("Then use: man infi");
}

async function cmdMan(): Promise<void> {
	const installed = resolveInstalledManpagePath();
	const preferredPath = fs.existsSync(installed)
		? installed
		: CLI_MANPAGE_SOURCE_PATH;

	if (!fs.existsSync(preferredPath)) {
		throw new Error(`Man page not found. Run \`infi install-man\` first.`);
	}

	const result = spawnSync("man", ["-l", preferredPath], { stdio: "inherit" });
	if (result.error) {
		if ((result.error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				"`man` command not found on this system. Open the file directly: " +
					preferredPath,
			);
		}
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(
			`Failed to render man page (exit ${String(result.status)})`,
		);
	}
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	if (!command || command === "help" || command === "--help") {
		printHelp();
		return;
	}

	switch (command) {
		case "daemon":
			await cmdDaemon(rest);
			return;
		case "play":
			await cmdPlay(rest);
			return;
		case "stop":
			await cmdStop();
			return;
		case "skip":
			await cmdSkip();
			return;
		case "thumb":
		case "thumbs":
			await cmdThumb(rest);
			return;
		case "volume":
			await cmdVolume(rest);
			return;
		case "mute":
			await cmdMute();
			return;
		case "room":
			await cmdRoom(rest);
			return;
		case "playlist":
			await cmdPlaylist(rest);
			return;
		case "song":
			await cmdSong(rest);
			return;
		case "config":
			await cmdConfig(rest);
			return;
		case "setup":
			await cmdConfig(rest, true);
			return;
		case "clear":
			await cmdClear(rest);
			return;
		case "status":
			await cmdStatus(rest);
			return;
		case "doctor":
			await cmdDoctor(rest);
			return;
		case "service":
			await cmdService(rest);
			return;
		case "install-cli":
			await cmdInstallCli();
			return;
		case "install-man":
			await cmdInstallMan();
			return;
		case "man":
			await cmdMan();
			return;
		default:
			throw new Error(`Unknown command: ${command}`);
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Error: ${message}`);
	process.exit(1);
});
