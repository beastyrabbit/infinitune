import fs from "node:fs";
import path from "node:path";
import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const isDev = process.env.NODE_ENV !== "production" && !isTest;

const LOG_LEVEL = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");
const FILE_LOGGING_ENABLED = !isTest && process.env.LOG_TO_FILE !== "0";

const LOGS_DIR = path.resolve(import.meta.dirname, "../../../data/logs/server");
const LOG_SESSION_ID = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE_PATH = FILE_LOGGING_ENABLED
	? path.join(LOGS_DIR, `server-${LOG_SESSION_ID}.ndjson`)
	: undefined;

if (LOG_FILE_PATH) {
	fs.mkdirSync(LOGS_DIR, { recursive: true });
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
			singleLine: false,
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
};

/** Create a child logger with song/playlist context */
export function songLogger(songId: string, playlistId?: string) {
	return logger.child({ songId, ...(playlistId && { playlistId }) });
}

/** Create a child logger with playlist context */
export function playlistLogger(playlistId: string) {
	return logger.child({ playlistId });
}
