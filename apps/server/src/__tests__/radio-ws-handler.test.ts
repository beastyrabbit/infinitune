import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
	heartbeatListener: vi.fn(),
}));

vi.mock("../events/event-bus", () => ({
	on: vi.fn(),
}));

vi.mock("../services/radio-station-service", () => ({
	activateListener: vi.fn(),
	addFeedback: vi.fn(),
	deactivateListener: vi.fn(),
	getStationSnapshot: vi.fn().mockReturnValue({}),
	heartbeatListener: mocks.heartbeatListener,
	seekStation: vi.fn(),
	skipStation: vi.fn(),
}));

import { handleRadioConnection } from "../radio/radio-ws-handler";

function fakeWebSocket() {
	const listeners = new Map<string, (value?: unknown) => void>();
	const sent: unknown[] = [];
	return {
		ws: {
			OPEN: 1,
			readyState: 1,
			on: vi.fn((event: string, listener: (value?: unknown) => void) => {
				listeners.set(event, listener);
			}),
			send: vi.fn((value: string) => sent.push(JSON.parse(value))),
		} as unknown as WebSocket,
		listeners,
		sent,
	};
}

async function sendHeartbeat(
	socket: ReturnType<typeof fakeWebSocket>,
	listenerId = "listener-1",
) {
	await sendRawMessage(
		socket,
		JSON.stringify({ type: "heartbeat", listenerId }),
	);
}

async function sendRawMessage(
	socket: ReturnType<typeof fakeWebSocket>,
	message: string,
) {
	socket.listeners.get("message")?.(Buffer.from(message));
	await Promise.resolve();
}

describe("radio WebSocket inbound message limiting", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		mocks.heartbeatListener.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows normal one-second heartbeats plus occasional commands", async () => {
		const socket = fakeWebSocket();
		handleRadioConnection(socket.ws);

		for (let second = 0; second < 60; second++) {
			await sendHeartbeat(socket);
			if (second % 10 === 0) {
				await sendRawMessage(socket, JSON.stringify({ type: "request" }));
			}
			await vi.advanceTimersByTimeAsync(1000);
		}

		expect(mocks.heartbeatListener).toHaveBeenCalledTimes(60);
		expect(
			socket.sent.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "pong",
			),
		).toHaveLength(60);
		expect(
			socket.sent.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"message" in message &&
					message.message ===
						"Radio requests must use POST /api/radio/requests",
			),
		).toHaveLength(6);

		socket.listeners.get("close")?.();
	});

	it("drops inbound floods before parsing and refills at two messages per second", async () => {
		const socket = fakeWebSocket();
		handleRadioConnection(socket.ws);

		for (let index = 0; index < 12; index++) {
			await sendRawMessage(socket, "not-json");
		}
		expect(
			socket.sent.filter(
				(message) =>
					typeof message === "object" &&
					message !== null &&
					"type" in message &&
					message.type === "error",
			),
		).toHaveLength(10);

		await vi.advanceTimersByTimeAsync(499);
		await sendHeartbeat(socket);
		expect(mocks.heartbeatListener).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await sendHeartbeat(socket);
		expect(mocks.heartbeatListener).toHaveBeenCalledOnce();

		socket.listeners.get("close")?.();
	});
});
