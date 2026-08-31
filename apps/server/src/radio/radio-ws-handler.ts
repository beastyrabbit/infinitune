import type { WebSocket } from "ws";
import { on } from "../events/event-bus";
import { logger } from "../logger";
import {
	activateListener,
	addFeedback,
	deactivateListener,
	getStationSnapshot,
	heartbeatListener,
	seekStation,
	skipStation,
} from "../services/radio-station-service";

const clients = new Set<WebSocket>();
let eventBridgeStarted = false;

// Number of open sockets currently holding each listener id active. Several
// browser tabs share one persisted listenerId, so a listener must only be
// deactivated once the LAST socket holding it releases — otherwise closing
// one tab silently drops a listener that another tab is still playing.
const listenerSocketCounts = new Map<string, number>();

function retainListener(id: string): void {
	listenerSocketCounts.set(id, (listenerSocketCounts.get(id) ?? 0) + 1);
}

/** Decrement the socket count for a listener; true when none remain. */
function releaseListener(id: string): boolean {
	const remaining = (listenerSocketCounts.get(id) ?? 0) - 1;
	if (remaining <= 0) {
		listenerSocketCounts.delete(id);
		return true;
	}
	listenerSocketCounts.set(id, remaining);
	return false;
}

function send(ws: WebSocket, payload: unknown) {
	if (ws.readyState !== ws.OPEN) return;
	ws.send(JSON.stringify(payload));
}

function broadcast(payload: unknown) {
	for (const client of [...clients]) {
		try {
			send(client, payload);
		} catch (err) {
			logger.warn({ err }, "Failed to send radio WS payload");
			clients.delete(client);
		}
	}
}

function broadcastState(type = "state") {
	broadcast({ type, ...getStationSnapshot() });
}

function startEventBridge() {
	if (eventBridgeStarted) return;
	eventBridgeStarted = true;
	on("radio.state_changed", () => broadcastState("state"));
	on("radio.schedule_changed", () => broadcastState("schedule"));
	on("radio.album_ready", () => broadcastState("schedule"));
	on("radio.request_updated", () => broadcastState("requests"));
}

function parseMessage(raw: Buffer | ArrayBuffer | Buffer[] | string) {
	try {
		return JSON.parse(raw.toString()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function handleRadioConnection(ws: WebSocket): void {
	startEventBridge();
	clients.add(ws);
	const listenerId = crypto.randomUUID();
	// The id this connection currently holds active (null while paused). The
	// client usually supplies its own persisted listenerId, which differs
	// from the connection-local UUID and may be shared across tabs.
	let heldListenerId: string | null = null;
	const pingTimer = setInterval(() => {
		send(ws, { type: "ping", serverTime: Date.now() });
	}, 5000);
	pingTimer.unref?.();

	send(ws, { type: "hello", listenerId, ...getStationSnapshot() });

	ws.on("message", (raw) => {
		const msg = parseMessage(raw);
		if (!msg || typeof msg.type !== "string") {
			send(ws, { type: "error", message: "Invalid radio message" });
			return;
		}

		const effectiveListenerId =
			typeof msg.listenerId === "string" && msg.listenerId.trim()
				? msg.listenerId.trim()
				: listenerId;

		Promise.resolve()
			.then(async () => {
				switch (msg.type) {
					case "play": {
						if (process.env.NODE_ENV === "production") {
							send(ws, {
								type: "error",
								message: "Radio playback must use POST /api/radio/play",
							});
							break;
						}
						const snapshot = await activateListener(effectiveListenerId);
						// Count this socket against the listener id, releasing any
						// previously held id (e.g. the client changed listenerId).
						if (heldListenerId !== effectiveListenerId) {
							if (heldListenerId && releaseListener(heldListenerId)) {
								deactivateListener(heldListenerId);
							}
							retainListener(effectiveListenerId);
							heldListenerId = effectiveListenerId;
						}
						send(ws, { type: "state", ...snapshot });
						break;
					}
					case "pause": {
						// This socket holds no listener (never played, or already
						// paused) — do nothing rather than blindly deactivating a
						// shared id another socket may still hold.
						if (!heldListenerId) {
							send(ws, { type: "state", ...getStationSnapshot() });
							break;
						}
						// Only deactivate when this was the last socket holding the id.
						const targetId = heldListenerId;
						const isLast = releaseListener(heldListenerId);
						heldListenerId = null;
						send(ws, {
							type: "state",
							...(isLast ? deactivateListener(targetId) : getStationSnapshot()),
						});
						break;
					}
					case "heartbeat":
						heartbeatListener(effectiveListenerId);
						send(ws, { type: "pong", serverTime: Date.now() });
						break;
					case "skip":
						if (process.env.NODE_ENV === "production") {
							send(ws, {
								type: "error",
								message: "Radio skipping must use POST /api/radio/skip",
							});
							break;
						}
						heartbeatListener(effectiveListenerId);
						send(ws, { type: "state", ...(await skipStation()) });
						break;
					case "seek":
						if (process.env.NODE_ENV === "production") {
							send(ws, {
								type: "error",
								message: "Radio seeking must use POST /api/radio/seek",
							});
							break;
						}
						heartbeatListener(effectiveListenerId);
						send(ws, {
							type: "state",
							...seekStation(Number(msg.offsetSeconds ?? 0)),
						});
						break;
					case "feedback":
						if (process.env.NODE_ENV === "production") {
							send(ws, {
								type: "error",
								message: "Radio feedback must use POST /api/radio/feedback",
							});
							break;
						}
						if (
							typeof msg.songId === "string" &&
							(msg.kind === "like" || msg.kind === "dislike")
						) {
							const snapshot = await addFeedback(msg.songId, msg.kind);
							if (snapshot) send(ws, { type: "state", ...snapshot });
						}
						break;
					case "request":
						send(ws, {
							type: "error",
							message: "Radio requests must use POST /api/radio/requests",
						});
						break;
					default:
						send(ws, {
							type: "error",
							message: `Unknown radio message ${msg.type}`,
						});
				}
			})
			.catch((err) => {
				logger.error({ err }, "Radio WS command failed");
				send(ws, {
					type: "error",
					message: err instanceof Error ? err.message : "Radio command failed",
				});
			});
	});

	ws.on("close", () => {
		clearInterval(pingTimer);
		clients.delete(ws);
		// Release this socket's hold; only deactivate when no other socket
		// (tab) is still holding the same listener id.
		if (heldListenerId && releaseListener(heldListenerId)) {
			deactivateListener(heldListenerId);
		}
		heldListenerId = null;
	});

	ws.on("error", (err) => {
		logger.error({ err }, "Radio WebSocket error");
	});
}
