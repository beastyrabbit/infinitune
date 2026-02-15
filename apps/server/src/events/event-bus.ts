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
	if (!handlers) return;
	for (const handler of handlers) {
		queueMicrotask(async () => {
			try {
				await handler(data);
			} catch (err) {
				console.error(`[event-bus] Handler error for ${event}:`, err);
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
