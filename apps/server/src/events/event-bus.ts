import { logger } from "../logger";

/** All events the system can emit, with typed payloads. */
export type EventMap = {
	"song.created": { songId: string; playlistId: string; status: string };
	"song.status_changed": {
		songId: string;
		playlistId: string;
		from: string;
		to: string;
	};
	"song.deleted": { songId: string; playlistId: string };
	"song.metadata_updated": { songId: string; playlistId: string };
	"song.reordered": { songId: string; playlistId: string };
	"playlist.created": { playlistId: string };
	"playlist.steered": { playlistId: string; newEpoch: number };
	"playlist.status_changed": {
		playlistId: string;
		from: string;
		to: string;
	};
	"playlist.updated": { playlistId: string };
	"playlist.heartbeat": { playlistId: string };
	"playlist.deleted": { playlistId: string };
	"settings.changed": { key: string };
};

type Handler<T> = (data: T) => void | Promise<void>;

const listeners = new Map<string, Set<Handler<unknown>>>();
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const isDev = process.env.NODE_ENV !== "production" && !isTest;
const EVENT_TRACE_ENABLED =
	process.env.LOG_EVENT_BUS !== undefined
		? process.env.LOG_EVENT_BUS !== "0"
		: isDev;
const EVENT_HANDLER_TRACE_ENABLED = process.env.LOG_EVENT_HANDLER_TRACE === "1";
const EVENT_HANDLER_SLOW_MS = Number(
	process.env.LOG_EVENT_HANDLER_SLOW_MS ?? 200,
);
let emittedSequence = 0;

/**
 * Subscribe to an event. Returns an unsubscribe function.
 */
export function on<K extends keyof EventMap>(
	event: K,
	handler: Handler<EventMap[K]>,
): () => void {
	let set = listeners.get(event);
	if (!set) {
		set = new Set();
		listeners.set(event, set);
	}
	set.add(handler as Handler<unknown>);
	return () => {
		set?.delete(handler as Handler<unknown>);
	};
}

/**
 * Emit an event. Handlers run in isolated microtasks — one handler
 * throwing doesn't kill others. Emit is fire-and-forget.
 */
export function emit<K extends keyof EventMap>(
	event: K,
	data: EventMap[K],
): void {
	const handlers = listeners.get(event);
	const sequence = ++emittedSequence;

	if (EVENT_TRACE_ENABLED) {
		logger.debug(
			{
				event,
				sequence,
				listenerCount: handlers?.size ?? 0,
				payload: data,
			},
			"Event emitted",
		);
	}

	if (!handlers) return;
	for (const handler of handlers) {
		queueMicrotask(async () => {
			const startedAt = Date.now();
			try {
				await handler(data);
				if (EVENT_TRACE_ENABLED) {
					const elapsedMs = Date.now() - startedAt;
					if (elapsedMs >= EVENT_HANDLER_SLOW_MS) {
						logger.warn(
							{ event, sequence, elapsedMs, slowMs: EVENT_HANDLER_SLOW_MS },
							"Event handler slow",
						);
					} else if (EVENT_HANDLER_TRACE_ENABLED) {
						logger.debug({ event, sequence, elapsedMs }, "Event handled");
					}
				}
			} catch (err) {
				logger.error({ err, event }, "Event handler error");
			}
		});
	}
}

/**
 * Remove all listeners (useful for tests).
 */
export function removeAllListeners(): void {
	listeners.clear();
}
