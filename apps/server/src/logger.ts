import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { captureLog } from "@infinitune/shared/telemetry-node";
import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const isDev = process.env.NODE_ENV !== "production" && !isTest;

const LOG_LEVEL = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");
const FILE_LOGGING_ENABLED = !isTest && process.env.LOG_TO_FILE !== "0";
const PRETTY_SINGLE_LINE = process.env.LOG_PRETTY_SINGLE_LINE !== "0";
const parsePositiveInt = (
	value: string | undefined,
	fallback: number,
): number => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const LOG_FILE_MAX_LINES = parsePositiveInt(
	process.env.LOG_FILE_MAX_LINES || "",
	10000,
);
const LOG_FILE_TRIM_INTERVAL_MS = parsePositiveInt(
	process.env.LOG_FILE_TRIM_INTERVAL_MS || "",
	15000,
);

const LOGS_DIR = path.resolve(import.meta.dirname, "../../../data/logs/server");
const LOG_FILE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const LOG_FILE_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;
const LOG_SESSION_ID = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE_PATH = FILE_LOGGING_ENABLED
	? path.join(LOGS_DIR, `server-${LOG_SESSION_ID}.ndjson`)
	: undefined;

if (LOG_FILE_PATH) {
	fs.mkdirSync(LOGS_DIR, { recursive: true });
	void trimLogFile();
	void expireLogFiles();
}

/** Filter all session files by entry age, with one cleanup interval of margin. */
export async function expireLogFiles(
	directory = LOGS_DIR,
	now = Date.now(),
	activeFile = LOG_FILE_PATH,
): Promise<void> {
	try {
		const entries = await fsPromises.readdir(directory, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			if (
				!entry.isFile() ||
				!/^server-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.ndjson$/.test(
					entry.name,
				)
			)
				continue;
			const file = path.join(directory, entry.name);
			try {
				const stat = await fsPromises.stat(file);
				const cutoff =
					now - LOG_FILE_RETENTION_MS + LOG_FILE_EXPIRY_INTERVAL_MS;
				const data = await fsPromises.readFile(file, "utf8");
				const lines = data
					.split(/\r?\n/)
					.filter((line) => line.trim().length > 0);
				const retained = lines.filter((line) => {
					try {
						const time: unknown = JSON.parse(line)?.time;
						if (typeof time === "number" && Number.isFinite(time)) {
							return time > cutoff;
						}
					} catch {
						// Malformed or untimestamped lines fall back to the file's age.
					}
					return stat.mtimeMs > cutoff;
				});
				if (retained.length === 0 && file !== activeFile) {
					await fsPromises.unlink(file);
				} else if (retained.length !== lines.length) {
					// Rewrite the same inode to keep Pino's open destination usable.
					await fsPromises.writeFile(
						file,
						retained.length ? `${retained.join("\n")}\n` : "",
						"utf8",
					);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.error("Failed to expire server log files", error);
		}
	}
}

export async function trimLogFile(file = LOG_FILE_PATH): Promise<void> {
	if (!file || LOG_FILE_MAX_LINES <= 0) return;
	try {
		const data = await fsPromises.readFile(file, "utf8");
		const lines = data.split(/\r?\n/).filter((line) => line.trim().length > 0);
		if (lines.length <= LOG_FILE_MAX_LINES) return;
		const retained = lines.slice(-LOG_FILE_MAX_LINES);

		const trimmed = retained.length > 0 ? `${retained.join("\n")}\n` : "";
		await fsPromises.writeFile(file, trimmed, "utf8");
	} catch (error: unknown) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as { code?: string }).code === "ENOENT"
		) {
			return;
		}
		console.error("Failed to trim server log file", error);
	}
}

if (LOG_FILE_PATH && LOG_FILE_TRIM_INTERVAL_MS > 0) {
	const trimLogTimer = setInterval(() => {
		void trimLogFile();
	}, LOG_FILE_TRIM_INTERVAL_MS);
	trimLogTimer.unref?.();
}

if (LOG_FILE_PATH) {
	const expiryTimer = setInterval(() => {
		void expireLogFiles();
	}, LOG_FILE_EXPIRY_INTERVAL_MS);
	expiryTimer.unref?.();
}

const transportTargets: pino.TransportTargetOptions[] = [];

if (isDev) {
	transportTargets.push({
		target: "pino-pretty",
		level: LOG_LEVEL,
		options: {
			colorize: true,
			ignore: "pid,hostname",
			translateTime: "HH:MM:ss",
			singleLine: PRETTY_SINGLE_LINE,
		},
	});
}

if (LOG_FILE_PATH) {
	transportTargets.push({
		target: "pino/file",
		level: LOG_LEVEL,
		options: {
			destination: LOG_FILE_PATH,
			mkdir: true,
		},
	});
}

export const logger = pino(
	{
		level: LOG_LEVEL,
		hooks: {
			logMethod(args, method, level) {
				if (level >= 50)
					captureLog(
						args,
						typeof args[1] === "string" ? args[1] : undefined,
						this.bindings(),
					);
				method.apply(this, args);
			},
		},
		base: {
			service: "infinitune-server",
			logSessionId: LOG_SESSION_ID,
		},
		redact: {
			paths: [
				"req.headers.authorization",
				"headers.authorization",
				"apiKey",
				"openrouterApiKey",
			],
			remove: true,
		},
	},
	transportTargets.length > 0
		? pino.transport({ targets: transportTargets })
		: undefined,
);

export const loggingConfig = {
	level: LOG_LEVEL,
	fileLoggingEnabled: Boolean(LOG_FILE_PATH),
	logFilePath: LOG_FILE_PATH,
	logSessionId: LOG_SESSION_ID,
	prettySingleLine: PRETTY_SINGLE_LINE,
};

/** Create a child logger with song/playlist context */
export function songLogger(songId: string, playlistId?: string) {
	return logger.child({ songId, ...(playlistId && { playlistId }) });
}

/** Create a child logger with playlist context */
export function playlistLogger(playlistId: string) {
	return logger.child({ playlistId });
}
