import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
	level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
	transport: isDev
		? {
				target: "pino-pretty",
				options: {
					colorize: true,
					ignore: "pid,hostname",
					translateTime: "HH:MM:ss",
				},
			}
		: undefined,
});

/** Create a child logger with song/playlist context */
export function songLogger(songId: string, playlistId?: string) {
	return logger.child({ songId, ...(playlistId && { playlistId }) });
}

/** Create a child logger with playlist context */
export function playlistLogger(playlistId: string) {
	return logger.child({ playlistId });
}
