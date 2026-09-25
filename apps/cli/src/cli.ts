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
	sendHouseCommand,
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
	isConnectedFlag,
	isStaleRoomPlaybackError,
	playInRoomSession,
} from "./lib/room-playback";
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

House Commands:
  infi house play|pause|stop|skip|mute [--playlist <playlist-id>] [--device-token <token>]
  infi house volume <0..1> [--playlist <playlist-id>] [--device-token <token>]

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

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Formats a value from untyped daemon JSON: scalars via String(), null and
 * undefined as the fallback. Any other value keeps String()'s default output.
 */
function formatDaemonValue(value: unknown, fallback: string): string {
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	if (value === null || value === undefined) return fallback;
	const nonScalar: unknown = value;
	return String(nonScalar);
}

function nonEmptyTrimmed(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function activeLocalPlaylist(
	status: Record<string, unknown>,
): string | undefined {
	return (
		nonEmptyString(status.localPlaylistName) ??
		nonEmptyString(status.localPlaylistId)
	);
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

function formatRuntimeLine(
	runtimeSec: number | undefined,
	durationSec: number | undefined,
): string | undefined {
	if (runtimeSec === undefined && durationSec === undefined) return undefined;
	const runtimeText = formatRuntimeClock(runtimeSec ?? 0);
	let line = `Runtime: ${runtimeText}`;
	if (durationSec === undefined) return line;
	line += ` / ${formatRuntimeClock(durationSec)}`;
	if (durationSec > 0 && runtimeSec !== undefined) {
		const ratio = Math.max(0, Math.min(1, runtimeSec / durationSec));
		line += ` (${Math.round(ratio * 100)}%)`;
	}
	return line;
}

function printSongRuntimeStatus(data: Record<string, unknown>): {
	hasSongLine: boolean;
} {
	const playback = data.playback as Record<string, unknown> | undefined;
	const engine = data.engine as Record<string, unknown> | undefined;
	const currentSong = data.currentSong as Record<string, unknown> | undefined;

	const title = nonEmptyTrimmed(currentSong?.title);
	const artist = nonEmptyTrimmed(currentSong?.artistName);
	const songId =
		nonEmptyString(currentSong?.id) ??
		nonEmptyString(playback?.currentSongId) ??
		nonEmptyString(engine?.songId);

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

	const runtimeLine = formatRuntimeLine(runtimeSec, durationSec);
	if (runtimeLine) {
		console.log(runtimeLine);
	}

	return { hasSongLine: Boolean(title) };
}

function printPlaybackVolumes(
	data: Record<string, unknown>,
	mode: string,
): void {
	const playback = data.playback as Record<string, unknown> | undefined;
	const engine = data.engine as Record<string, unknown> | undefined;
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
}

function printLastError(data: Record<string, unknown>): void {
	const lastError = nonEmptyString(data.lastError);
	if (lastError) {
		console.log(`Last Error: ${lastError}`);
	}
}

function formatRoomLabel(
	roomId: string | undefined,
	roomName: string | undefined,
): string {
	if (!roomId) return "-";
	const roomNameSuffix = roomName ? ` (${roomName})` : "";
	return `${roomId}${roomNameSuffix}`;
}

function printDaemonHttpInfo(
	data: Record<string, unknown>,
	config: InfiConfig,
	fallbackHost: string,
	fallbackPort: number,
): void {
	console.log(`Config Server: ${config.serverUrl}`);
	const daemonHttpUrl =
		asString(data.daemonHttpUrl) ??
		formatDaemonHttpUrl(fallbackHost, fallbackPort);
	console.log(`Daemon HTTP: ${daemonHttpUrl}`);
	console.log(
		`Config Daemon HTTP: ${formatDaemonHttpUrl(config.daemonHttpHost, config.daemonHttpPort)}`,
	);
	console.log(`Queue Length: ${formatDaemonValue(data.queueLength, "0")}`);
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

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

type DaemonLaunchOptions = {
	serverUrl: string;
	roomId?: string;
	playlistKey?: string;
	roomName?: string;
	deviceName: string;
	deviceToken?: string;
	daemonHttpHost: string;
	daemonHttpPort: number;
};

function resolveDaemonLaunchOptions(
	parsed: ReturnType<typeof parseArgs>,
	serverUrl: string,
	config: InfiConfig,
): DaemonLaunchOptions {
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
	return {
		serverUrl,
		roomId,
		playlistKey,
		roomName,
		deviceName,
		deviceToken,
		daemonHttpHost,
		daemonHttpPort,
	};
}

async function joinLaunchRoom(options: DaemonLaunchOptions): Promise<void> {
	const { serverUrl, roomId, playlistKey, roomName, deviceName } = options;
	if (!roomId) return;
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

async function daemonStart(options: DaemonLaunchOptions): Promise<void> {
	if (await isDaemonResponsive()) {
		console.log("Daemon already running.");
		return;
	}
	await startDaemonProcess(options);
	console.log("Daemon started.");
	await joinLaunchRoom(options);
}

async function daemonRestart(options: DaemonLaunchOptions): Promise<void> {
	if (await isDaemonResponsive()) {
		const shutdownResponse = await sendDaemonRequest("shutdown");
		requireOk(shutdownResponse);
		const stopped = await waitForDaemonStopped();
		if (!stopped) {
			throw new Error("Timed out waiting for daemon to stop.");
		}
	}
	await startDaemonProcess(options);
	console.log("Daemon restarted.");
	await joinLaunchRoom(options);
}

async function daemonStop(): Promise<void> {
	if (!(await isDaemonResponsive())) {
		console.log("Daemon is not running.");
		return;
	}
	const response = await sendDaemonRequest("shutdown");
	requireOk(response);
	console.log("Daemon stopping.");
}

function printDaemonStatusOverview(
	data: Record<string, unknown>,
	mode: string,
): void {
	const roomDeviceMode = asString(data.roomDeviceMode) ?? "-";
	const roomName = asString(data.roomName);
	console.log(`Daemon: running (pid ${String(data.pid ?? "?")})`);
	console.log(`Mode: ${mode}`);
	console.log(`Connected: ${data.connected ? "yes" : "no"}`);
	console.log(
		`Room: ${formatRoomLabel(nonEmptyString(data.roomId), roomName)}`,
	);
	console.log(
		`Assigned Playlist: ${formatDaemonValue(data.assignedPlaylistId, "-")}`,
	);
	console.log(
		`Device Token: ${data.deviceTokenConfigured ? "configured" : "not set"}`,
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
}

async function daemonStatus(
	options: DaemonLaunchOptions,
	config: InfiConfig,
): Promise<void> {
	if (!(await isDaemonResponsive())) {
		console.log("Daemon: not running");
		return;
	}
	const response = await sendDaemonRequest("status");
	const data = asRecord(requireOk(response));
	const mode = nonEmptyString(data.mode) ?? "room";
	printDaemonStatusOverview(data, mode);
	printDaemonHttpInfo(
		data,
		config,
		options.daemonHttpHost,
		options.daemonHttpPort,
	);
	printPlaybackVolumes(data, mode);
	printSongRuntimeStatus(data);
	printLastError(data);
}

async function cmdDaemon(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "status";
	const serverUrl = resolveServerUrl(parsed);
	const config = loadConfig();
	const options = resolveDaemonLaunchOptions(parsed, serverUrl, config);

	switch (sub) {
		case "run":
			await runDaemonRuntime(options);
			return;
		case "start":
			await daemonStart(options);
			return;
		case "restart":
			await daemonRestart(options);
			return;
		case "stop":
			await daemonStop();
			return;
		case "status":
			await daemonStatus(options, config);
			return;
		default:
			throw new Error(`Unknown daemon subcommand: ${sub}`);
	}
}

async function playLocalPlaylist(
	parsed: ReturnType<typeof parseArgs>,
	config: InfiConfig,
	serverUrl: string,
	deviceName: string,
): Promise<void> {
	const playlist = await resolvePlaylist(serverUrl, {
		explicitPlaylistKey: getFlagString(parsed, "playlist-key"),
		defaultPlaylistKey: config.defaultPlaylistKey,
		interactivePlaylist: true,
		deviceToken: config.deviceToken ?? undefined,
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
}

async function playJoinedRoom(
	serverUrl: string,
	deviceName: string,
	status: Record<string, unknown>,
	joinedRoomId: string,
): Promise<boolean> {
	const joinedRoomName = nonEmptyString(status.roomName);
	const joinedPlaylistKey = nonEmptyString(status.playlistKey);
	const isConnected = isConnectedFlag(status.connected);
	try {
		await playInRoomSession(sendDaemonRequest, {
			serverUrl,
			roomId: joinedRoomId,
			playlistKey: joinedPlaylistKey,
			roomName: joinedRoomName,
			expectedPlaylistKey: joinedPlaylistKey,
			deviceName,
			connected: isConnected,
		});
		console.log(`Playing in room ${joinedRoomId}.`);
		return true;
	} catch (error) {
		if (!isStaleRoomPlaybackError(error)) {
			throw error;
		}
		console.warn(
			`Warning: previous room session ${joinedRoomId} is stale (${toErrorMessage(error)}). Resolving current playlist session...`,
		);
		return false;
	}
}

async function playAssignedPlaylist(
	serverUrl: string,
	deviceName: string,
	assignedPlaylistId: string,
): Promise<void> {
	await playInRoomSession(sendDaemonRequest, {
		serverUrl,
		roomId: assignedPlaylistId,
		expectedPlaylistKey: assignedPlaylistId,
		deviceName,
		connected: false,
	});
	patchConfig({
		serverUrl,
		deviceName,
		defaultRoomId: assignedPlaylistId,
	});
	console.log(`Playing assigned playlist session ${assignedPlaylistId}.`);
}

/** Resumes the daemon's current room session; returns true when playback started. */
async function resumeDaemonRoomSession(
	serverUrl: string,
	deviceName: string,
): Promise<boolean> {
	const statusResponse = await sendDaemonRequest("status");
	const status = asRecord(requireOk(statusResponse));
	const daemonMode = asString(status.mode) ?? "room";
	if (daemonMode !== "room") return false;

	const joinedRoomId = nonEmptyString(status.roomId);
	if (
		joinedRoomId &&
		(await playJoinedRoom(serverUrl, deviceName, status, joinedRoomId))
	) {
		return true;
	}

	const assignedPlaylistId = nonEmptyString(status.assignedPlaylistId);
	if (assignedPlaylistId) {
		await playAssignedPlaylist(serverUrl, deviceName, assignedPlaylistId);
		return true;
	}
	return false;
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
		await playLocalPlaylist(parsed, config, serverUrl, deviceName);
		return;
	}

	const explicitRoomId = getFlagString(parsed, "room");
	const explicitPlaylistKey = getFlagString(parsed, "playlist-key");
	if (
		!explicitRoomId &&
		!explicitPlaylistKey &&
		(await resumeDaemonRoomSession(serverUrl, deviceName))
	) {
		return;
	}

	const resolved = await resolveRoom(serverUrl, {
		explicitRoomId,
		explicitPlaylistKey,
		defaultRoomId: config.defaultRoomId,
		defaultPlaylistKey: config.defaultPlaylistKey,
		interactivePlaylist: true,
		deviceToken: config.deviceToken ?? undefined,
	});

	await playInRoomSession(sendDaemonRequest, {
		serverUrl,
		roomId: resolved.room.id,
		playlistKey: resolved.room.playlistKey,
		roomName: resolved.room.name,
		expectedPlaylistKey: resolved.room.playlistKey ?? undefined,
		deviceName,
		connected: false,
	});

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

function printHouseSubcommandHelp(): void {
	console.log("House commands:");
	console.log(
		"  infi house play|pause|stop|skip|mute [--playlist <playlist-id>] [--device-token <token>]",
	);
	console.log(
		"  infi house volume <0..1> [--playlist <playlist-id>] [--device-token <token>]",
	);
}

async function cmdHouse(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0];
	if (!sub || sub === "help" || sub === "--help") {
		printHouseSubcommandHelp();
		return;
	}

	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);
	const playlistId = getFlagString(parsed, "playlist");
	const deviceToken =
		getFlagString(parsed, "device-token", "token") ?? config.deviceToken;
	if (!deviceToken) {
		throw new Error(
			"House commands require a device token. Set one with `infi config --device-token <token>`.",
		);
	}

	let action: "play" | "pause" | "stop" | "skip" | "toggleMute" | "setVolume";
	let payload: Record<string, unknown> | undefined;

	switch (sub) {
		case "play":
		case "pause":
		case "stop":
		case "skip":
			action = sub;
			break;
		case "mute":
			action = "toggleMute";
			break;
		case "volume": {
			const rawValue = parsed.positionals[1] ?? getFlagString(parsed, "value");
			if (!rawValue) {
				throw new Error("Usage: infi house volume <0..1> [--playlist <id>]");
			}
			const volume = Number(rawValue);
			if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
				throw new Error("volume must be a number between 0 and 1");
			}
			action = "setVolume";
			payload = { volume };
			break;
		}
		default:
			throw new Error(`Unknown house subcommand: ${sub}`);
	}

	const response = await sendHouseCommand(
		serverUrl,
		{
			action,
			payload,
			playlistIds: playlistId ? [playlistId] : undefined,
		},
		{ deviceToken },
	);

	console.log(
		`House command ${action} applied to ${response.affectedPlaylistIds.length} playlist session(s).`,
	);
	if (response.skippedPlaylistIds.length > 0) {
		console.log(
			`Skipped ${response.skippedPlaylistIds.length} playlist(s): ${response.skippedPlaylistIds.join(", ")}`,
		);
	}
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

async function leaveRoom(): Promise<void> {
	if (!(await isDaemonResponsive())) {
		console.log("Daemon is not running. No room to leave.");
		return;
	}
	const statusResponse = await sendDaemonRequest("status");
	const status = requireOk(statusResponse) as Record<string, unknown>;
	const mode = asString(status.mode) ?? "room";
	if (mode !== "room") {
		console.log("Daemon is not in room mode. No room session to leave.");
		return;
	}
	const roomId = nonEmptyString(status.roomId);
	if (!roomId) {
		console.log("No active room session.");
		return;
	}
	const response = await sendDaemonRequest("leaveRoom");
	requireOk(response);
	const verifyResponse = await sendDaemonRequest("status");
	const verifyStatus = requireOk(verifyResponse) as Record<string, unknown>;
	const remainingRoomId = nonEmptyString(verifyStatus.roomId);
	if (remainingRoomId) {
		throw new Error(
			`Daemon did not leave room session (still in ${remainingRoomId}). Run \`infi daemon restart\` and retry.`,
		);
	}
	console.log(`Left room ${roomId}.`);
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
		await leaveRoom();
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
			const room = await pickExistingRoom(serverUrl, {
				deviceToken: config.deviceToken ?? undefined,
			});
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

async function leaveLocalPlaylist(): Promise<void> {
	if (!(await isDaemonResponsive())) {
		console.log("Daemon is not running. No local playlist to leave.");
		return;
	}
	const statusResponse = await sendDaemonRequest("status");
	const status = requireOk(statusResponse) as Record<string, unknown>;
	const mode = asString(status.mode) ?? "room";
	if (mode !== "local") {
		console.log("Daemon is not in local mode. No playlist session to leave.");
		return;
	}
	const playlistLabel = activeLocalPlaylist(status);
	const response = await sendDaemonRequest("leavePlaylist");
	requireOk(response);
	const verifyResponse = await sendDaemonRequest("status");
	const verifyStatus = requireOk(verifyResponse) as Record<string, unknown>;
	const verifyMode = asString(verifyStatus.mode) ?? "room";
	const remainingPlaylist = activeLocalPlaylist(verifyStatus);
	if (verifyMode === "local" && remainingPlaylist) {
		throw new Error(
			`Daemon did not leave local playlist (still using ${remainingPlaylist}). Run \`infi daemon restart\` and retry.`,
		);
	}
	console.log(`Left local playlist ${playlistLabel ?? "(unknown)"}.`);
}

async function cmdPlaylist(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "leave";
	if (sub === "leave") {
		await leaveLocalPlaylist();
		return;
	}
	throw new Error(`Unknown playlist subcommand: ${sub}`);
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
		const connected = isConnectedFlag(status.connected);
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

function printStatusOverview(
	daemonData: Record<string, unknown>,
	mode: string,
	serverUrl: string,
): void {
	const roomDeviceMode = asString(daemonData.roomDeviceMode);
	const roomId = asString(daemonData.roomId);
	const roomName = asString(daemonData.roomName);
	const assignedPlaylistId = asString(daemonData.assignedPlaylistId);
	const deviceTokenConfigured =
		typeof daemonData.deviceTokenConfigured === "boolean"
			? daemonData.deviceTokenConfigured
			: false;
	const localPlaylistName = asString(daemonData.localPlaylistName);
	const localPlaylistId = asString(daemonData.localPlaylistId);

	console.log(`Daemon: running (pid ${String(daemonData.pid ?? "?")})`);
	console.log(`Mode: ${mode}`);
	console.log(`Connected: ${daemonData.connected ? "yes" : "no"}`);
	console.log(`Room: ${formatRoomLabel(roomId, roomName)}`);
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
}

async function printRoomSessionNowPlaying(
	serverUrl: string,
	roomId: string,
	config: InfiConfig,
): Promise<void> {
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
	} catch (error) {
		console.warn(
			`Warning: failed to query room session ${roomId}: ${toErrorMessage(error)}`,
		);
	}
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
	const mode = nonEmptyString(daemonData.mode) ?? "room";
	const roomId = asString(daemonData.roomId);

	printStatusOverview(daemonData, mode, serverUrl);
	printDaemonHttpInfo(
		daemonData,
		config,
		config.daemonHttpHost,
		config.daemonHttpPort,
	);
	printPlaybackVolumes(daemonData, mode);
	const songStatus = printSongRuntimeStatus(daemonData);
	printLastError(daemonData);

	if (mode === "room" && roomId && !songStatus.hasSongLine) {
		await printRoomSessionNowPlaying(serverUrl, roomId, config);
	}
}

type DoctorReport = {
	warn: (text: string) => void;
	ok: (text: string) => void;
};

function checkDoctorMode(mode: string, report: DoctorReport): void {
	if (mode !== "room") {
		report.warn(`daemon mode is "${mode}" (room checks are limited)`);
	} else {
		report.ok("daemon mode is room");
	}
}

function checkDoctorServer(
	daemonServer: string | undefined,
	serverUrl: string,
	report: DoctorReport,
): void {
	if (daemonServer && daemonServer !== serverUrl) {
		report.warn(
			`daemon server (${daemonServer}) differs from target server (${serverUrl})`,
		);
	} else if (daemonServer) {
		report.ok(`daemon server matches target (${daemonServer})`);
	} else {
		report.warn("daemon has no server URL configured");
	}
}

function checkDoctorRoom(
	roomId: string | undefined,
	report: DoctorReport,
): void {
	if (!roomId) {
		report.warn("daemon is not joined to a room");
	} else {
		report.ok(`daemon room is ${roomId}`);
	}
}

function checkDoctorRoomProtocol(
	daemonData: Record<string, unknown>,
	report: DoctorReport,
): void {
	if (typeof daemonData.joinAcknowledged === "boolean") {
		if (daemonData.joinAcknowledged) {
			report.ok("join acknowledgment received");
		} else {
			report.warn("join acknowledgment missing");
		}
	}
	if (typeof daemonData.roomProtocolVersion === "number") {
		report.ok(
			`room protocol version v${String(daemonData.roomProtocolVersion)}`,
		);
	}
	const lastDisconnectReason = nonEmptyString(daemonData.lastDisconnectReason);
	if (lastDisconnectReason) {
		report.warn(`last disconnect reason: ${lastDisconnectReason}`);
	}
}

async function checkDoctorPlaylistSession(
	serverUrl: string,
	roomId: string,
	config: InfiConfig,
	report: DoctorReport,
): Promise<void> {
	try {
		await getPlaylistSession(serverUrl, roomId, {
			deviceToken: config.deviceToken ?? undefined,
		});
		report.ok("playlist session exists on target server");
	} catch (error) {
		report.warn(
			`unable to resolve playlist session on target server (${toErrorMessage(error)})`,
		);
	}

	try {
		const session = await getPlaylistSession(serverUrl, roomId, {
			deviceToken: config.deviceToken ?? undefined,
		});
		if (session.currentSong?.title) {
			report.ok(
				`playlist session responds (now playing: ${session.currentSong.title})`,
			);
		} else {
			report.ok("playlist session responds");
		}
	} catch (error) {
		report.warn(`playlist session endpoint failed (${toErrorMessage(error)})`);
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
	const mode = nonEmptyString(daemonData.mode) ?? "room";
	const roomId = nonEmptyString(daemonData.roomId);
	const connected = Boolean(daemonData.connected);
	const connectionState = asString(daemonData.connectionState) ?? "unknown";
	const daemonServer = asString(daemonData.serverUrl);

	let issues = 0;
	const report: DoctorReport = {
		warn: (text: string) => {
			issues += 1;
			console.log(`- WARN: ${text}`);
		},
		ok: (text: string) => {
			console.log(`- OK: ${text}`);
		},
	};

	checkDoctorMode(mode, report);
	checkDoctorServer(daemonServer, serverUrl, report);
	checkDoctorRoom(roomId, report);
	if (connected && connectionState === "connected") {
		report.ok("room websocket is connected");
	} else {
		report.warn(`room websocket is ${connectionState}`);
	}

	if (mode === "room") {
		checkDoctorRoomProtocol(daemonData, report);
	}

	if (roomId) {
		await checkDoctorPlaylistSession(serverUrl, roomId, config, report);
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
	deviceToken?: string,
): Promise<string | null> {
	let playlists: Awaited<ReturnType<typeof listPlaylists>>;
	try {
		playlists = await listPlaylists(serverUrl, { deviceToken });
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
			current.deviceToken ?? undefined,
		);

		return patch;
	} finally {
		rl.close();
	}
}

function readConfigFlags(parsed: ReturnType<typeof parseArgs>) {
	return {
		server: getFlagString(parsed, "server"),
		deviceName: getFlagString(parsed, "device-name", "device"),
		deviceTokenRaw: getFlagString(parsed, "device-token", "token"),
		volumeStepRaw: getFlagString(parsed, "volume-step", "step"),
		playbackModeRaw: getFlagString(parsed, "mode"),
		daemonHttpHostRaw: getFlagString(parsed, "daemon-host", "http-host"),
		daemonHttpPortRaw: getFlagString(parsed, "daemon-port", "http-port"),
		defaultRoomId: getFlagString(parsed, "default-room", "room"),
		defaultPlaylistKey: getFlagString(
			parsed,
			"default-playlist-key",
			"playlist-key",
		),
		localFlag: hasFlag(parsed, "local"),
		roomModeFlag: hasFlag(parsed, "room-mode"),
		clearRoom: parsed.flags.has("clear-room"),
		clearPlaylist: parsed.flags.has("clear-playlist"),
		clearToken: parsed.flags.has("clear-token"),
	};
}

type ConfigFlags = ReturnType<typeof readConfigFlags>;

function hasConfigFlagUpdates(flags: ConfigFlags): boolean {
	return (
		typeof flags.server === "string" ||
		typeof flags.deviceName === "string" ||
		typeof flags.deviceTokenRaw === "string" ||
		typeof flags.volumeStepRaw === "string" ||
		typeof flags.playbackModeRaw === "string" ||
		typeof flags.daemonHttpHostRaw === "string" ||
		typeof flags.daemonHttpPortRaw === "string" ||
		flags.localFlag ||
		flags.roomModeFlag ||
		typeof flags.defaultRoomId === "string" ||
		typeof flags.defaultPlaylistKey === "string" ||
		flags.clearRoom ||
		flags.clearPlaylist ||
		flags.clearToken
	);
}

function requireTrimmed(value: string, name: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error(`${name} cannot be empty`);
	}
	return trimmed;
}

function parseVolumeStepSetting(raw: string): number {
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0 || value > 1) {
		throw new Error("volume-step must be a number between 0 and 1");
	}
	return value;
}

function applyConfigValueFlags(
	patch: Partial<InfiConfig>,
	flags: ConfigFlags,
	current: InfiConfig,
): void {
	if (typeof flags.server === "string") {
		patch.serverUrl = normalizeServerSetting(flags.server);
	}
	if (typeof flags.deviceName === "string") {
		patch.deviceName = requireTrimmed(flags.deviceName, "device-name");
	}
	if (typeof flags.deviceTokenRaw === "string") {
		patch.deviceToken = requireTrimmed(flags.deviceTokenRaw, "device-token");
	}
	if (typeof flags.volumeStepRaw === "string") {
		patch.volumeStep = parseVolumeStepSetting(flags.volumeStepRaw);
	}
	if (typeof flags.playbackModeRaw === "string") {
		patch.playbackMode = parsePlaybackMode(
			flags.playbackModeRaw,
			current.playbackMode,
		);
	}
	if (typeof flags.daemonHttpHostRaw === "string") {
		patch.daemonHttpHost = normalizeDaemonHostSetting(flags.daemonHttpHostRaw);
	}
	if (typeof flags.daemonHttpPortRaw === "string") {
		patch.daemonHttpPort = normalizeDaemonPortSetting(flags.daemonHttpPortRaw);
	}
}

function applyConfigSelectionFlags(
	patch: Partial<InfiConfig>,
	flags: ConfigFlags,
): void {
	if (flags.localFlag) {
		patch.playbackMode = "local";
	}
	if (flags.roomModeFlag) {
		patch.playbackMode = "room";
	}
	if (typeof flags.defaultRoomId === "string") {
		patch.defaultRoomId = flags.defaultRoomId.trim() || null;
	}
	if (typeof flags.defaultPlaylistKey === "string") {
		patch.defaultPlaylistKey = flags.defaultPlaylistKey.trim() || null;
	}
	if (flags.clearRoom) {
		patch.defaultRoomId = null;
	}
	if (flags.clearPlaylist) {
		patch.defaultPlaylistKey = null;
	}
	if (flags.clearToken) {
		patch.deviceToken = null;
	}
}

function buildDaemonConfigPatch(
	patch: Partial<InfiConfig>,
): Record<string, unknown> {
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
	return daemonPatch;
}

async function applyConfigToDaemon(patch: Partial<InfiConfig>): Promise<void> {
	if (!(await isDaemonResponsive())) return;
	const daemonPatch = buildDaemonConfigPatch(patch);
	if (Object.keys(daemonPatch).length === 0) return;
	try {
		const response = await sendDaemonRequest("configure", daemonPatch);
		requireOk(response);
		console.log("Applied config changes to running daemon.");
	} catch (error) {
		console.log(
			`Warning: failed to apply config to daemon (${toErrorMessage(error)}). Run \`infi daemon restart\` if needed.`,
		);
	}
}

async function cmdConfig(args: string[], setupMode = false): Promise<void> {
	const parsed = parseArgs(args);
	const current = loadConfig();
	const interactive =
		hasFlag(parsed, "interactive", "wizard") ||
		(setupMode && parsed.positionals.length === 0 && parsed.flags.size === 0);

	const flags = readConfigFlags(parsed);
	const hasUpdates = interactive || hasConfigFlagUpdates(flags);

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

	applyConfigValueFlags(patch, flags, current);
	applyConfigSelectionFlags(patch, flags);

	const next = patchConfig(patch, current);
	console.log("Updated infi config.");
	printConfig(next);

	await applyConfigToDaemon(patch);
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
		const roomId = nonEmptyString(status.roomId);
		const localPlaylist = activeLocalPlaylist(status);
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
			`Warning: failed to clear daemon session (${toErrorMessage(error)}). Run \`infi daemon restart\` if needed.`,
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
		case "house":
			await cmdHouse(rest);
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
