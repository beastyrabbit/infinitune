import type { WSContext } from "hono/ws";
import { type EventMap, on } from "./event-bus";

type WSClient = WSContext;

const clients = new Set<WSClient>();

/** Register a new browser WebSocket client. */
export function addClient(ws: WSClient) {
	clients.add(ws);
}

/** Remove a disconnected browser WebSocket client. */
export function removeClient(ws: WSClient) {
	clients.delete(ws);
}

/** Get the number of connected browser clients. */
export function getClientCount(): number {
	return clients.size;
}

/** Broadcast a JSON message to all connected browser clients. */
function broadcast(routingKey: string, data: unknown) {
	const message = JSON.stringify({ routingKey, data });
	for (const client of [...clients]) {
		try {
			client.send(message);
		} catch (err) {
			console.warn(
				"[ws-bridge] Failed to send to client, removing:",
				err instanceof Error ? err.message : err,
			);
			clients.delete(client);
		}
	}
}

/**
 * Map event bus events to WebSocket routing keys that match the browser's
 * existing invalidation logic. The browser provider filters by routingKey
 * to invalidate only relevant React Query keys.
 *
 * Old routing keys (from RabbitMQ):
 *   songs.{playlistId}  — any song change for a playlist
 *   playlists            — any playlist change
 *   settings             — any settings change
 */
function eventToRoutingKey(
	event: string,
	data: Record<string, unknown>,
): string {
	if (event.startsWith("song.")) {
		return `songs.${data.playlistId}`;
	}
	if (event.startsWith("playlist.")) {
		return "playlists";
	}
	if (event.startsWith("settings.")) {
		return "settings";
	}
	return event;
}

/**
 * Start the event bus → WebSocket bridge.
 * Subscribes to all events and broadcasts to connected browsers.
 * Replaces the old RabbitMQ → WebSocket bridge.
 */
export function startWsBridge(): void {
	// List of all events to forward to browsers
	const events: (keyof EventMap)[] = [
		"song.created",
		"song.status_changed",
		"song.deleted",
		"song.metadata_updated",
		"song.reordered",
		"playlist.created",
		"playlist.steered",
		"playlist.status_changed",
		"playlist.updated",
		"playlist.deleted",
		"settings.changed",
	];

	for (const event of events) {
		on(event, (data) => {
			const routingKey = eventToRoutingKey(
				event,
				data as Record<string, unknown>,
			);
			broadcast(routingKey, data);
		});
	}

	// Don't forward playlist.heartbeat — internal only, high frequency
	console.log("[ws-bridge] Event bus bridge started");
}
