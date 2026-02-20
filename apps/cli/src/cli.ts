#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig, patchConfig } from "./config";
import { runDaemonRuntime } from "./daemon/runtime";
import { getNowPlaying, normalizeServerUrl } from "./lib/api";
import { getFlagNumber, getFlagString, parseArgs } from "./lib/flags";
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
} from "./lib/paths";
import {
	pickExistingRoom,
	pickSongFromQueue,
	resolveRoom,
} from "./lib/room-resolution";

function printHelp(): void {
	console.log(`
Usage:
  infi play [--room <id>] [--playlist-key <key>] [--server <url>]
  infi stop
  infi skip
  infi volume up|down [--step 0.05]
  infi mute
  infi status
  infi room join --room <id>
  infi room pick
  infi song pick

  infi daemon start|stop|status
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

async function waitForDaemonReady(timeoutMs = 6000): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await isDaemonResponsive()) return true;
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
	const args = ["--import", "tsx", CLI_ENTRY_PATH, "daemon", "run"];
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
	const config = loadConfig();
	const serverUrl =
		getFlagString(parsed, "server") ?? normalizeServerUrl(config.serverUrl);
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
			console.log(`Daemon: running (pid ${String(data.pid ?? "?")})`);
			console.log(`Connected: ${data.connected ? "yes" : "no"}`);
			console.log(`Room: ${String(data.roomId ?? "-")}`);
			console.log(`Server: ${String(data.serverUrl ?? "-")}`);
			const playback = data.playback as Record<string, unknown> | undefined;
			if (playback) {
				console.log(`Playing: ${playback.isPlaying ? "yes" : "no"}`);
				console.log(
					`Volume: ${toDisplayPercent(
						typeof playback.volume === "number" ? playback.volume : undefined,
					)}`,
				);
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
	const serverUrl = normalizeServerUrl(
		getFlagString(parsed, "server") ?? config.serverUrl,
	);
	const deviceName = getFlagString(parsed, "device-name") ?? config.deviceName;

	const resolved = await resolveRoom(serverUrl, {
		explicitRoomId: getFlagString(parsed, "room"),
		explicitPlaylistKey: getFlagString(parsed, "playlist-key"),
		defaultRoomId: config.defaultRoomId,
		defaultPlaylistKey: config.defaultPlaylistKey,
		interactivePlaylist: true,
	});

	await ensureDaemonRunning(serverUrl, deviceName);

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
	const serverUrl = normalizeServerUrl(
		getFlagString(parsed, "server") ?? config.serverUrl,
	);
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
			patchConfig({ serverUrl, deviceName, defaultRoomId: roomId });
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
	const songId = pickSongFromQueue(queue);
	const selectResponse = await sendDaemonRequest("selectSong", { songId });
	requireOk(selectResponse);
	console.log(`Selected song ${songId}.`);
}

async function cmdStatus(args: string[]): Promise<void> {
	const parsed = parseArgs(args);
	const config = loadConfig();
	const serverUrl = normalizeServerUrl(
		getFlagString(parsed, "server") ?? config.serverUrl,
	);

	if (!(await isDaemonResponsive())) {
		console.log("Daemon: not running");
		return;
	}

	const daemonResponse = await sendDaemonRequest("status");
	const daemonData = requireOk(daemonResponse) as Record<string, unknown>;
	const roomId =
		typeof daemonData.roomId === "string" ? daemonData.roomId : undefined;

	console.log(`Daemon: running (pid ${String(daemonData.pid ?? "?")})`);
	console.log(`Connected: ${daemonData.connected ? "yes" : "no"}`);
	console.log(`Room: ${roomId ?? "-"}`);
	console.log(`Server: ${String(daemonData.serverUrl ?? serverUrl)}`);

	const playback = daemonData.playback as Record<string, unknown> | undefined;
	if (playback) {
		console.log(`Playing: ${playback.isPlaying ? "yes" : "no"}`);
		console.log(
			`Volume: ${toDisplayPercent(
				typeof playback.volume === "number" ? playback.volume : undefined,
			)}`,
		);
	}

	if (roomId) {
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

function writeExecutableScript(targetPath: string): void {
	const script = `#!/usr/bin/env bash
set -euo pipefail
exec ${process.execPath} --import tsx ${CLI_ENTRY_PATH} "$@"
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
	const config = loadConfig();
	const unitName = "infinitune-daemon.service";
	const unitDir = getSystemdUserDir();
	const unitPath = path.join(unitDir, unitName);
	const serverUrl = normalizeServerUrl(
		getFlagString(parsed, "server") ?? config.serverUrl,
	);

	switch (sub) {
		case "install": {
			fs.mkdirSync(unitDir, { recursive: true });
			const unitFile = `[Unit]
Description=Infinitune Terminal Daemon
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
ExecStart=${process.execPath} --import tsx ${CLI_ENTRY_PATH} daemon run --server ${serverUrl}
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
