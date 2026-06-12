import type { WebSocket } from "ws";
import { on } from "../events/event-bus";
import { logger } from "../logger";
import { submitRadioRequest } from "../services/radio-request-service";
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
					case "play":
						send(ws, {
							type: "state",
							...(await activateListener(effectiveListenerId)),
						});
						break;
					case "pause":
						send(ws, {
							type: "state",
							...deactivateListener(effectiveListenerId),
						});
						break;
					case "heartbeat":
						heartbeatListener(effectiveListenerId);
						send(ws, { type: "pong", serverTime: Date.now() });
						break;
					case "skip":
						heartbeatListener(effectiveListenerId);
						send(ws, { type: "state", ...(await skipStation()) });
						break;
					case "seek":
						heartbeatListener(effectiveListenerId);
						send(ws, {
							type: "state",
							...seekStation(Number(msg.offsetSeconds ?? 0)),
						});
						break;
					case "feedback":
						if (
							typeof msg.songId === "string" &&
							(msg.kind === "like" || msg.kind === "dislike")
						) {
							send(ws, {
								type: "state",
								...(await addFeedback(msg.songId, msg.kind)),
							});
						}
						break;
					case "request":
						if (typeof msg.prompt === "string") {
							send(ws, {
								type: "request",
								request: await submitRadioRequest(msg.prompt),
							});
						}
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
		deactivateListener(listenerId);
	});

	ws.on("error", (err) => {
		logger.error({ err }, "Radio WebSocket error");
	});
}
