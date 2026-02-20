import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CLI_ENTRY_PATH = path.resolve(LIB_DIR, "../cli.ts");
export const CLI_PACKAGE_ROOT = path.resolve(LIB_DIR, "../..");
export const REPO_ROOT = path.resolve(LIB_DIR, "../../../..");
export const TSX_LOADER_PATH = path.resolve(
	REPO_ROOT,
	"node_modules/tsx/dist/loader.mjs",
);

export function getConfigRoot(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg && xdg.trim().length > 0) {
		return path.join(xdg, "infinitune");
	}
	return path.join(os.homedir(), ".config", "infinitune");
}

export function getStateRoot(): string {
	const xdg = process.env.XDG_STATE_HOME;
	if (xdg && xdg.trim().length > 0) {
		return path.join(xdg, "infinitune");
	}
	return path.join(os.homedir(), ".local", "state", "infinitune");
}

export function getRuntimeRoot(): string {
	const xdg = process.env.XDG_RUNTIME_DIR;
	if (xdg && xdg.trim().length > 0) {
		return path.join(xdg, "infinitune");
	}

	const uid =
		typeof process.getuid === "function" ? String(process.getuid()) : "user";
	return path.join(os.tmpdir(), `infinitune-${uid}`);
}

export type RuntimePaths = {
	runtimeRoot: string;
	socketPath: string;
	pidPath: string;
	logPath: string;
};

export function getRuntimePaths(): RuntimePaths {
	const runtimeRoot = getRuntimeRoot();
	let socketPath = path.join(runtimeRoot, "daemon.sock");
	if (socketPath.length >= 100) {
		socketPath = path.join(os.tmpdir(), "infinitune-daemon.sock");
	}
	return {
		runtimeRoot,
		socketPath,
		pidPath: path.join(runtimeRoot, "daemon.pid"),
		logPath: path.join(runtimeRoot, "daemon.log"),
	};
}

export function getLocalBinDir(): string {
	return path.join(os.homedir(), ".local", "bin");
}

export function getSystemdUserDir(): string {
	return path.join(os.homedir(), ".config", "systemd", "user");
}
