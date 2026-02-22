import { describe, expect, it, vi } from "vitest";
import type { DaemonAction, IpcResponse } from "./ipc";
import {
	isConnectedFlag,
	isStaleRoomPlaybackError,
	playInRoomSession,
	waitForRoomJoin,
} from "./room-playback";

function response(data: Partial<IpcResponse>): IpcResponse {
	return {
		id: "req-1",
		ok: true,
		...data,
	};
}

type Step = {
	action: DaemonAction;
	response: IpcResponse;
};

function makeSender(steps: Step[]) {
	const queue = [...steps];
	const calls: Array<{
		action: DaemonAction;
		payload?: Record<string, unknown>;
	}> = [];
	const send = vi.fn(
		async (action: DaemonAction, payload?: Record<string, unknown>) => {
			calls.push({ action, payload });
			const next = queue.shift();
			if (!next) {
				throw new Error(`Unexpected daemon action: ${action}`);
			}
			if (next.action !== action) {
				throw new Error(
					`Expected daemon action ${next.action}, got ${action} instead.`,
				);
			}
			return next.response;
		},
	);
	return { send, calls };
}

describe("room-playback", () => {
	it("treats only literal true as connected", () => {
		expect(isConnectedFlag(true)).toBe(true);
		expect(isConnectedFlag(false)).toBe(false);
		expect(isConnectedFlag("true")).toBe(false);
		expect(isConnectedFlag("false")).toBe(false);
		expect(isConnectedFlag(1)).toBe(false);
		expect(isConnectedFlag(null)).toBe(false);
	});

	it("rejoins and waits for status before play when disconnected", async () => {
		const { send, calls } = makeSender([
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: false, roomId: "room-1" },
				}),
			},
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			playlistKey: "playlist-1",
			roomName: "Kitchen",
			connected: false,
			joinCheckAttempts: 3,
			joinCheckIntervalMs: 0,
		});

		expect(calls.map((entry) => entry.action)).toEqual([
			"joinRoom",
			"status",
			"status",
			"play",
		]);
		expect(calls[0]?.payload).toEqual({
			serverUrl: "http://localhost:5175",
			roomId: "room-1",
			playlistKey: "playlist-1",
			roomName: "Kitchen",
			deviceName: "kitchen",
		});
	});

	it("plays immediately without rejoin when already connected", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			connected: true,
		});

		expect(calls.map((entry) => entry.action)).toEqual(["status", "play"]);
	});

	it("plays without reconnect when playlist key matches in a different room", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: {
						connected: true,
						roomId: "room-2",
						playlistKey: "playlist-1",
					},
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			expectedPlaylistKey: "playlist-1",
			connected: true,
		});

		expect(calls.map((entry) => entry.action)).toEqual(["status", "play"]);
	});

	it("throws when join never reaches connected room state", async () => {
		const { send, calls } = makeSender([
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: false, roomId: "room-1" },
				}),
			},
		]);

		await expect(
			playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: false,
				joinCheckAttempts: 1,
				joinCheckIntervalMs: 0,
			}),
		).rejects.toThrow("Daemon did not reconnect to room room-1.");
		expect(calls.map((entry) => entry.action)).not.toContain("play");
	});

	it("waitForRoomJoin retries until connection is ready", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: false, roomId: "room-1" },
				}),
			},
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
		]);

		await waitForRoomJoin(send, "room-1", 3, 0);
		expect(calls.map((entry) => entry.action)).toEqual(["status", "status"]);
	});

	it("waitForRoomJoin recovers from transient status failures", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: false,
					error: "temporary status failure",
				}),
			},
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
		]);

		await waitForRoomJoin(send, "room-1", 3, 0);
		expect(calls.map((entry) => entry.action)).toEqual(["status", "status"]);
	});

	it("waitForRoomJoin rejects when connected to a different room", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-2" },
				}),
			},
		]);

		await expect(waitForRoomJoin(send, "room-1", 1, 0)).rejects.toThrow(
			"Daemon did not reconnect to room room-1.",
		);
		expect(calls.map((entry) => entry.action)).toEqual(["status"]);
	});

	it("throws immediately when joinRoom fails", async () => {
		const { send, calls } = makeSender([
			{
				action: "joinRoom",
				response: response({
					ok: false,
					error: "join failed",
				}),
			},
		]);

		let thrown: unknown;
		try {
			await playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: false,
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).toMatchObject({ message: "join failed" });
		expect(isStaleRoomPlaybackError(thrown)).toBe(false);
		expect(calls.map((entry) => entry.action)).toEqual(["joinRoom"]);
	});

	it("marks missing-room join errors as stale-room-session", async () => {
		const { send, calls } = makeSender([
			{
				action: "joinRoom",
				response: response({
					ok: false,
					error: "Session room-1 not found",
				}),
			},
		]);

		let thrown: unknown;
		try {
			await playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: false,
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).toMatchObject({ message: "Session room-1 not found" });
		expect(isStaleRoomPlaybackError(thrown)).toBe(true);
		expect(calls.map((entry) => entry.action)).toEqual(["joinRoom"]);
	});

	it("throws when status polling fails during reconnect", async () => {
		const { send, calls } = makeSender([
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: false,
					error: "status failed",
				}),
			},
		]);

		await expect(
			playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: false,
				joinCheckAttempts: 1,
				joinCheckIntervalMs: 0,
			}),
		).rejects.toThrow("status failed");
		expect(calls.map((entry) => entry.action)).toEqual(["joinRoom", "status"]);
	});

	it("throws when play action fails", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{
				action: "play",
				response: response({
					ok: false,
					error: "play failed",
				}),
			},
		]);

		await expect(
			playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: true,
			}),
		).rejects.toThrow("play failed");
		expect(calls.map((entry) => entry.action)).toEqual(["status", "play"]);
	});

	it("does not retry play for non-disconnect room errors", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{
				action: "play",
				response: response({
					ok: false,
					error: 'room command "play" is unavailable',
				}),
			},
		]);

		await expect(
			playInRoomSession(send, {
				serverUrl: "http://localhost:5175",
				deviceName: "kitchen",
				roomId: "room-1",
				connected: true,
				joinCheckAttempts: 1,
				joinCheckIntervalMs: 0,
			}),
		).rejects.toThrow('room command "play" is unavailable');
		expect(calls.map((entry) => entry.action)).toEqual(["status", "play"]);
	});

	it("reconnects when connected status points at a different room", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-2" },
				}),
			},
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			connected: true,
			joinCheckAttempts: 1,
			joinCheckIntervalMs: 0,
		});

		expect(calls.map((entry) => entry.action)).toEqual([
			"status",
			"joinRoom",
			"status",
			"play",
		]);
	});

	it("accepts playlist-key match when room id differs", async () => {
		const { send, calls } = makeSender([
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: {
						connected: true,
						roomId: "room-2",
						playlistKey: "playlist-1",
					},
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "playlist-1",
			expectedPlaylistKey: "playlist-1",
			connected: false,
			joinCheckAttempts: 1,
			joinCheckIntervalMs: 0,
		});

		expect(calls.map((entry) => entry.action)).toEqual([
			"joinRoom",
			"status",
			"play",
		]);
	});

	it("retries once when play fails with reconnectable error", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{
				action: "play",
				response: response({
					ok: false,
					error: "not connected to room",
				}),
			},
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			connected: true,
			joinCheckAttempts: 1,
			joinCheckIntervalMs: 0,
		});

		expect(calls.map((entry) => entry.action)).toEqual([
			"status",
			"play",
			"joinRoom",
			"status",
			"play",
		]);
	});

	it("reconnects when initial status check fails despite connected hint", async () => {
		const { send, calls } = makeSender([
			{
				action: "status",
				response: response({
					ok: false,
					error: "status unavailable",
				}),
			},
			{ action: "joinRoom", response: response({ ok: true }) },
			{
				action: "status",
				response: response({
					ok: true,
					data: { connected: true, roomId: "room-1" },
				}),
			},
			{ action: "play", response: response({ ok: true }) },
		]);

		await playInRoomSession(send, {
			serverUrl: "http://localhost:5175",
			deviceName: "kitchen",
			roomId: "room-1",
			connected: true,
			joinCheckAttempts: 1,
			joinCheckIntervalMs: 0,
		});

		expect(calls.map((entry) => entry.action)).toEqual([
			"status",
			"joinRoom",
			"status",
			"play",
		]);
	});
});
