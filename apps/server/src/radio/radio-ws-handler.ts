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

// The frontend sends one heartbeat per second plus occasional controls. Allow
// brief timer/reconnect bursts, but bound all inbound work from one socket.
const INBOUND_MESSAGE_BURST_CAPACITY = 10;
const INBOUND_MESSAGE_REFILL_PER_MS = 2 / 1000;

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

type RadioMessage = Record<string, unknown>;

interface RadioConnection {
	ws: WebSocket;
	// The id this connection currently holds active (null while paused). The
	// client usually supplies its own persisted listenerId, which differs
	// from the connection-local UUID and may be shared across tabs.
	heldListenerId: string | null;
}

function resolveListenerId(msg: RadioMessage, fallback: string): string {
	return typeof msg.listenerId === "string" && msg.listenerId.trim()
		? msg.listenerId.trim()
		: fallback;
}

async function handlePlayMessage(
	conn: RadioConnection,
	effectiveListenerId: string,
): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		send(conn.ws, {
			type: "error",
			message: "Radio playback must use POST /api/radio/play",
		});
		return;
	}
	const snapshot = await activateListener(effectiveListenerId);
	// Count this socket against the listener id, releasing any
	// previously held id (e.g. the client changed listenerId).
	if (conn.heldListenerId !== effectiveListenerId) {
		if (conn.heldListenerId && releaseListener(conn.heldListenerId)) {
			deactivateListener(conn.heldListenerId);
		}
		retainListener(effectiveListenerId);
		conn.heldListenerId = effectiveListenerId;
	}
	send(conn.ws, { type: "state", ...snapshot });
}

function handlePauseMessage(conn: RadioConnection): void {
	// This socket holds no listener (never played, or already
	// paused) — do nothing rather than blindly deactivating a
	// shared id another socket may still hold.
	if (!conn.heldListenerId) {
		send(conn.ws, { type: "state", ...getStationSnapshot() });
		return;
	}
	// Only deactivate when this was the last socket holding the id.
	const targetId = conn.heldListenerId;
	const isLast = releaseListener(conn.heldListenerId);
	conn.heldListenerId = null;
	send(conn.ws, {
		type: "state",
		...(isLast ? deactivateListener(targetId) : getStationSnapshot()),
	});
}

async function handleSkipMessage(
	conn: RadioConnection,
	effectiveListenerId: string,
): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		send(conn.ws, {
			type: "error",
			message: "Radio skipping must use POST /api/radio/skip",
		});
		return;
	}
	heartbeatListener(effectiveListenerId);
	send(conn.ws, { type: "state", ...(await skipStation()) });
}

function handleSeekMessage(
	conn: RadioConnection,
	msg: RadioMessage,
	effectiveListenerId: string,
): void {
	if (process.env.NODE_ENV === "production") {
		send(conn.ws, {
			type: "error",
			message: "Radio seeking must use POST /api/radio/seek",
		});
		return;
	}
	heartbeatListener(effectiveListenerId);
	send(conn.ws, {
		type: "state",
		...seekStation(Number(msg.offsetSeconds ?? 0)),
	});
}

async function handleFeedbackMessage(
	conn: RadioConnection,
	msg: RadioMessage,
): Promise<void> {
	if (process.env.NODE_ENV === "production") {
		send(conn.ws, {
			type: "error",
			message: "Radio feedback must use POST /api/radio/feedback",
		});
		return;
	}
	if (
		typeof msg.songId === "string" &&
		(msg.kind === "like" || msg.kind === "dislike")
	) {
		const snapshot = await addFeedback(msg.songId, msg.kind);
		if (snapshot) send(conn.ws, { type: "state", ...snapshot });
	}
}

async function dispatchRadioMessage(
	conn: RadioConnection,
	msg: RadioMessage,
	effectiveListenerId: string,
): Promise<void> {
	switch (msg.type) {
		case "play":
			await handlePlayMessage(conn, effectiveListenerId);
			break;
		case "pause":
			handlePauseMessage(conn);
			break;
		case "heartbeat":
			heartbeatListener(effectiveListenerId);
			send(conn.ws, { type: "pong", serverTime: Date.now() });
			break;
		case "skip":
			await handleSkipMessage(conn, effectiveListenerId);
			break;
		case "seek":
			handleSeekMessage(conn, msg, effectiveListenerId);
			break;
		case "feedback":
			await handleFeedbackMessage(conn, msg);
			break;
		case "request":
			send(conn.ws, {
				type: "error",
				message: "Radio requests must use POST /api/radio/requests",
			});
			break;
		default:
			send(conn.ws, {
				type: "error",
				message: `Unknown radio message ${msg.type}`,
			});
	}
}

export function handleRadioConnection(ws: WebSocket): void {
	startEventBridge();
	clients.add(ws);
	const listenerId = crypto.randomUUID();
	let inboundMessageTokens = INBOUND_MESSAGE_BURST_CAPACITY;
	let inboundMessageLastRefillAt = Date.now();
	const consumeInboundMessageToken = () => {
		const now = Date.now();
		inboundMessageTokens = Math.min(
			INBOUND_MESSAGE_BURST_CAPACITY,
			inboundMessageTokens +
				Math.max(0, now - inboundMessageLastRefillAt) *
					INBOUND_MESSAGE_REFILL_PER_MS,
		);
		inboundMessageLastRefillAt = now;
		if (inboundMessageTokens < 1) return false;
		inboundMessageTokens -= 1;
		return true;
	};
	const conn: RadioConnection = { ws, heldListenerId: null };
	const pingTimer = setInterval(() => {
		send(ws, { type: "ping", serverTime: Date.now() });
	}, 5000);
	pingTimer.unref?.();

	send(ws, { type: "hello", listenerId, ...getStationSnapshot() });

	ws.on("message", (raw) => {
		// Limit before parsing or dispatching, and silently drop excess messages
		// to avoid turning an inbound flood into outbound response amplification.
		if (!consumeInboundMessageToken()) return;
		const msg = parseMessage(raw);
		if (!msg || typeof msg.type !== "string") {
			send(ws, { type: "error", message: "Invalid radio message" });
			return;
		}

		const effectiveListenerId = resolveListenerId(msg, listenerId);

		Promise.resolve()
			.then(() => dispatchRadioMessage(conn, msg, effectiveListenerId))
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
		if (conn.heldListenerId && releaseListener(conn.heldListenerId)) {
			deactivateListener(conn.heldListenerId);
		}
		conn.heldListenerId = null;
	});

	ws.on("error", (err) => {
		logger.error({ err }, "Radio WebSocket error");
	});
}
