import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfigRoot } from "./lib/paths";

const CONFIG_VERSION = 4;

export type PlaybackMode = "room" | "local";

export interface InfiConfig {
	version: number;
	serverUrl: string;
	deviceName: string;
	playbackMode: PlaybackMode;
	defaultRoomId: string | null;
	defaultPlaylistKey: string | null;
	deviceToken: string | null;
	volumeStep: number;
	daemonHttpHost: string;
	daemonHttpPort: number;
}

const DEFAULT_SERVER_URL =
	process.env.INFI_SERVER_URL ?? "http://localhost:5175";

function defaultDeviceName(): string {
	const host = os.hostname().trim();
	if (!host) return "INFINITUNE TERMINAL";
	return host.replace(/[^A-Za-z0-9_-]+/g, "-").toUpperCase();
}

function defaultConfig(): InfiConfig {
	return {
		version: CONFIG_VERSION,
		serverUrl: DEFAULT_SERVER_URL,
		deviceName: defaultDeviceName(),
		playbackMode: "room",
		defaultRoomId: null,
		defaultPlaylistKey: null,
		deviceToken: null,
		volumeStep: 0.05,
		daemonHttpHost: "127.0.0.1",
		daemonHttpPort: 17653,
	};
}

function sanitize(raw: Partial<InfiConfig> | null | undefined): InfiConfig {
	const defaults = defaultConfig();
	if (!raw) return defaults;

	const serverUrl =
		typeof raw.serverUrl === "string" && raw.serverUrl.trim().length > 0
			? raw.serverUrl
			: defaults.serverUrl;

	const deviceName =
		typeof raw.deviceName === "string" && raw.deviceName.trim().length > 0
			? raw.deviceName
			: defaults.deviceName;

	const playbackMode: PlaybackMode =
		raw.playbackMode === "local" ? "local" : "room";

	const volumeStep =
		typeof raw.volumeStep === "number" &&
		Number.isFinite(raw.volumeStep) &&
		raw.volumeStep > 0 &&
		raw.volumeStep <= 1
			? raw.volumeStep
			: defaults.volumeStep;

	const daemonHttpHost =
		typeof raw.daemonHttpHost === "string" &&
		raw.daemonHttpHost.trim().length > 0
			? raw.daemonHttpHost.trim()
			: defaults.daemonHttpHost;

	const daemonHttpPort =
		typeof raw.daemonHttpPort === "number" &&
		Number.isInteger(raw.daemonHttpPort) &&
		raw.daemonHttpPort >= 1 &&
		raw.daemonHttpPort <= 65535
			? raw.daemonHttpPort
			: defaults.daemonHttpPort;

	return {
		version: CONFIG_VERSION,
		serverUrl,
		deviceName,
		playbackMode,
		defaultRoomId:
			typeof raw.defaultRoomId === "string" ? raw.defaultRoomId : null,
		defaultPlaylistKey:
			typeof raw.defaultPlaylistKey === "string"
				? raw.defaultPlaylistKey
				: null,
		deviceToken:
			typeof raw.deviceToken === "string" && raw.deviceToken.trim().length > 0
				? raw.deviceToken.trim()
				: null,
		volumeStep,
		daemonHttpHost,
		daemonHttpPort,
	};
}

export function getConfigPath(): string {
	return path.join(getConfigRoot(), "config.json");
}

export function loadConfig(): InfiConfig {
	const configPath = getConfigPath();
	if (!fs.existsSync(configPath)) {
		return defaultConfig();
	}

	try {
		const raw = JSON.parse(
			fs.readFileSync(configPath, "utf8"),
		) as Partial<InfiConfig>;
		return sanitize(raw);
	} catch {
		return defaultConfig();
	}
}

export function saveConfig(next: InfiConfig): void {
	const configPath = getConfigPath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	const sanitized = sanitize(next);
	fs.writeFileSync(
		configPath,
		`${JSON.stringify(sanitized, null, 2)}\n`,
		"utf8",
	);
}

export function patchConfig(
	patch: Partial<InfiConfig>,
	current = loadConfig(),
): InfiConfig {
	const merged = { ...current, ...patch };
	const sanitized = sanitize(merged);
	saveConfig(sanitized);
	return sanitized;
}
