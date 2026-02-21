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
import { getNowPlaying, listPlaylists, normalizeServerUrl } from "./lib/api";
import { getFlagNumber, getFlagString, hasFlag, parseArgs } from "./lib/flags";
import { pickFromFzf } from "./lib/fzf";
import {
	cleanupStaleRuntimeFiles,
	isDaemonResponsive,
	sendDaemonRequest,
} from "./lib/ipc";
import {
	CLI_ENTRY_PATH,
	getLocalBinDir,
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
Usage:
  infi play [--room <id>] [--playlist-key <key>] [--local] [--server <url>]
  infi stop
  infi skip
  infi volume up|down [--step 0.05]
  infi mute
  infi status
  infi room join --room <id>
  infi room pick
  infi song pick
  infi config [--server <url>] [--device-name <name>] [--volume-step <n>]
             [--mode room|local] [--interactive]
  infi setup [--server <url>]

  infi daemon start|stop|status|restart
  infi service install|uninstall|restart
  infi install-cli
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

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
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

function resolveServerUrl(parsed: ReturnType<typeof parseArgs>): string {
	const config = loadConfig();
	const raw = getFlagString(parsed, "server") ?? config.serverUrl;
	return normalizeServerSetting(raw);
}

function printConfig(config: InfiConfig): void {
	console.log("Current infi config:");
	console.log(`  serverUrl: ${config.serverUrl}`);
	console.log(`  deviceName: ${config.deviceName}`);
	console.log(`  playbackMode: ${config.playbackMode}`);
	console.log(`  volumeStep: ${config.volumeStep}`);
	console.log(`  defaultRoomId: ${config.defaultRoomId ?? "-"}`);
	console.log(`  defaultPlaylistKey: ${config.defaultPlaylistKey ?? "-"}`);
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

	const child = spawn(process.execPath, args, {
		detached: true,
		cwd: REPO_ROOT,
		stdio: ["ignore", logFd, logFd],
	});
	child.unref();
	fs.closeSync(logFd);

	const ready = await waitForDaemonReady();
	if (!ready) {
		throw new Error(
			`Daemon failed to start. Check log file: ${runtimePaths.logPath}`,
		);
	}
}

async function ensureDaemonRunning(
	serverUrl: string,
	deviceName: string,
): Promise<void> {
	if (await isDaemonResponsive()) return;
	await startDaemonProcess({ serverUrl, deviceName });
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

	switch (sub) {
		case "run": {
			await runDaemonRuntime({
				serverUrl,
				roomId,
				playlistKey,
				roomName,
				deviceName,
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
			const data = requireOk(response) as Record<string, unknown>;
			const mode =
				typeof data.mode === "string" && data.mode.length > 0
					? data.mode
					: "room";
			console.log(`Daemon: running (pid ${String(data.pid ?? "?")})`);
			console.log(`Mode: ${mode}`);
			console.log(`Connected: ${data.connected ? "yes" : "no"}`);
			console.log(`Room: ${String(data.roomId ?? "-")}`);
			if (mode === "local") {
				console.log(
					`Local Playlist: ${String(data.localPlaylistName ?? data.localPlaylistId ?? "-")}`,
				);
			}
			console.log(`Server: ${String(data.serverUrl ?? "-")}`);
			console.log(`Config Server: ${config.serverUrl}`);
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

	await ensureDaemonRunning(serverUrl, deviceName);

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
			playbackMode: "local",
			defaultPlaylistKey: playlist.playlistKey ?? null,
		});

		console.log(
			`Playing locally from playlist ${playlist.playlistKey ?? playlist.id} (${playlist.name}).`,
		);
		return;
	}

	const resolved = await resolveRoom(serverUrl, {
		explicitRoomId: getFlagString(parsed, "room"),
		explicitPlaylistKey: getFlagString(parsed, "playlist-key"),
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
		playbackMode: "room",
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
	const data = requireOk(response) as { volume?: number };
	console.log(`Volume: ${toDisplayPercent(data.volume)}`);
}

async function cmdMute(): Promise<void> {
	const response = await sendDaemonRequest("toggleMute");
	requireOk(response);
	console.log("Toggled mute.");
}

async function cmdRoom(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const sub = parsed.positionals[0] ?? "pick";
	const config = loadConfig();
	const serverUrl = resolveServerUrl(parsed);
	const deviceName = getFlagString(parsed, "device-name") ?? config.deviceName;

	await ensureDaemonRunning(serverUrl, deviceName);

	switch (sub) {
		case "join": {
			const roomId = getFlagString(parsed, "room");
			if (!roomId) {
				throw new Error("Usage: infi room join --room <id>");
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
				playbackMode: "room",
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
				playbackMode: "room",
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
	const daemonData = requireOk(daemonResponse) as Record<string, unknown>;
	const mode =
		typeof daemonData.mode === "string" && daemonData.mode.length > 0
			? daemonData.mode
			: "room";
	const roomId =
		typeof daemonData.roomId === "string" ? daemonData.roomId : undefined;
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
	console.log(`Room: ${roomId ?? "-"}`);
	if (mode === "local") {
		console.log(
			`Local Playlist: ${localPlaylistName ?? localPlaylistId ?? "-"}`,
		);
	}
	console.log(`Server: ${String(daemonData.serverUrl ?? serverUrl)}`);
	console.log(`Config Server: ${config.serverUrl}`);
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
	if (
		typeof daemonData.lastError === "string" &&
		daemonData.lastError.length > 0
	) {
		console.log(`Last Error: ${daemonData.lastError}`);
	}

	if (mode === "room" && roomId) {
		try {
			const nowPlaying = await getNowPlaying(serverUrl, roomId);
			if (nowPlaying.song?.title) {
				console.log(`Now Playing: ${nowPlaying.song.title}`);
				if (nowPlaying.song.artistName) {
					console.log(`Artist: ${nowPlaying.song.artistName}`);
				}
			}
		} catch {
			// Keep status output usable even if server query fails.
		}
	}
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
	const volumeStepRaw = getFlagString(parsed, "volume-step", "step");
	const playbackModeRaw = getFlagString(parsed, "mode");
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

	const hasUpdates =
		interactive ||
		typeof server === "string" ||
		typeof deviceName === "string" ||
		typeof volumeStepRaw === "string" ||
		typeof playbackModeRaw === "string" ||
		localFlag ||
		roomModeFlag ||
		typeof defaultRoomId === "string" ||
		typeof defaultPlaylistKey === "string" ||
		clearRoom ||
		clearPlaylist;

	if (!hasUpdates) {
		if (setupMode) {
			console.log("Usage: infi setup --server <url>");
			console.log(
				"Optional: --device-name <name> --volume-step <n> --mode room|local",
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
		if (typeof patch.playbackMode === "string") {
			daemonPatch.playbackMode = patch.playbackMode;
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

	switch (sub) {
		case "install": {
			fs.mkdirSync(unitDir, { recursive: true });
			const unitFile = `[Unit]
Description=Infinitune Terminal Daemon
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
ExecStart=${process.execPath} --import ${TSX_LOADER_PATH} ${CLI_ENTRY_PATH} daemon run --server ${serverUrl}
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
		case "volume":
			await cmdVolume(rest);
			return;
		case "mute":
			await cmdMute();
			return;
		case "room":
			await cmdRoom(rest);
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
		case "status":
			await cmdStatus(rest);
			return;
		case "service":
			await cmdService(rest);
			return;
		case "install-cli":
			await cmdInstallCli();
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
