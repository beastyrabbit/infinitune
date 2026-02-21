import type { SongData } from "@infinitune/shared/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { Room } from "../room/room";

// ─── Mock WebSocket ─────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: test helper
type Msg = Record<string, any>;

function createMockWs() {
	const messages: Msg[] = [];
	return {
		ws: {
			readyState: 1, // OPEN
			send: vi.fn((data: string) => messages.push(JSON.parse(data))),
		} as unknown as WebSocket,
		messages,
	};
}

function song(id: string, overrides: Partial<SongData> = {}): SongData {
	return {
		id: id,
		status: "ready",
		orderIndex: 0,
		createdAt: Date.now(),
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("Room", () => {
	let room: Room;

	beforeEach(() => {
		room = new Room("room-1", "Test Room", "playlist-key-1");
	});

	afterEach(() => {
		room.dispose();
	});

	// ─── Device management ──────────────────────────────────────────

	describe("device management", () => {
		it("adds a device and sends current state", () => {
			const { ws, messages } = createMockWs();
			room.addDevice({ id: "d1", name: "Phone", role: "controller" }, ws);

			expect(room.getDeviceCount()).toBe(1);
			expect(messages.length).toBeGreaterThan(0);
			expect(messages[0]).toMatchObject({ type: "state" });
		});

		it("sends current song to player on join", () => {
			const queue = [song("s-1", { audioUrl: "/audio/1.mp3", orderIndex: 1 })];
			room.updateQueue(queue, 0);

			const { ws, messages } = createMockWs();
			room.addDevice({ id: "d1", name: "Speaker", role: "player" }, ws);

			// Should have state + queue + nextSong messages
			const nextSong = messages.find((m) => m.type === "nextSong");
			expect(nextSong).toBeDefined();
		});

		it("removes a device", () => {
			const { ws } = createMockWs();
			room.addDevice({ id: "d1", name: "Phone", role: "controller" }, ws);
			expect(room.getDeviceCount()).toBe(1);

			room.removeDevice("d1");
			expect(room.getDeviceCount()).toBe(0);
		});

		it("reports isEmpty correctly", () => {
			expect(room.isEmpty()).toBe(true);
			const { ws } = createMockWs();
			room.addDevice({ id: "d1", name: "Phone", role: "controller" }, ws);
			expect(room.isEmpty()).toBe(false);
		});
	});

	// ─── Commands: play/pause/toggle ────────────────────────────────

	describe("play/pause/toggle", () => {
		it("play sets isPlaying to true", () => {
			room.handleCommand("d1", "play");
			expect(room.playback.isPlaying).toBe(true);
		});

		it("pause sets isPlaying to false", () => {
			room.playback.isPlaying = true;
			room.handleCommand("d1", "pause");
			expect(room.playback.isPlaying).toBe(false);
		});

		it("toggle flips isPlaying", () => {
			expect(room.playback.isPlaying).toBe(false);
			room.handleCommand("d1", "toggle");
			expect(room.playback.isPlaying).toBe(true);
			room.handleCommand("d1", "toggle");
			expect(room.playback.isPlaying).toBe(false);
		});

		it("broadcasts execute to player devices", () => {
			const { ws } = createMockWs();
			room.addDevice({ id: "d1", name: "Speaker", role: "player" }, ws);

			room.handleCommand("d1", "play");

			const playCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls
				.map((args) => JSON.parse(args[0] as string) as Msg)
				.filter((m) => m.type === "execute" && m.action === "play");
			expect(playCalls.length).toBeGreaterThan(0);
		});
	});

	// ─── Commands: seek ─────────────────────────────────────────────

	describe("seek", () => {
		it("updates currentTime", () => {
			room.handleCommand("d1", "seek", { time: 42.5 });
			expect(room.playback.currentTime).toBe(42.5);
		});
	});

	// ─── Commands: volume ───────────────────────────────────────────

	describe("volume", () => {
		it("setVolume updates volume", () => {
			room.handleCommand("d1", "setVolume", { volume: 0.5 });
			expect(room.playback.volume).toBe(0.5);
		});

		it("toggleMute flips isMuted", () => {
			expect(room.playback.isMuted).toBe(false);
			room.handleCommand("d1", "toggleMute");
			expect(room.playback.isMuted).toBe(true);
			room.handleCommand("d1", "toggleMute");
			expect(room.playback.isMuted).toBe(false);
		});
	});

	// ─── Commands: selectSong ───────────────────────────────────────

	describe("selectSong", () => {
		it("advances to the selected song", () => {
			const queue = [
				song("s-1", {
					audioUrl: "/a/1.mp3",
					orderIndex: 1,
					audioDuration: 180,
				}),
				song("s-2", {
					audioUrl: "/a/2.mp3",
					orderIndex: 2,
					audioDuration: 200,
				}),
			];
			room.updateQueue(queue, 0);

			room.handleCommand("d1", "selectSong", { songId: "s-2" });

			expect(room.playback.currentSongId).toBe("s-2");
			expect(room.playback.isPlaying).toBe(true);
			expect(room.playback.currentTime).toBe(0);
		});

		it("ignores songs without audioUrl", () => {
			const queue = [song("s-1", { orderIndex: 1 })]; // no audioUrl
			room.updateQueue(queue, 0);

			room.handleCommand("d1", "selectSong", { songId: "s-1" });

			// Should still be on whatever song was current (queue auto-start may have skipped it)
			expect(room.playback.currentSongId).not.toBe("s-1");
		});
	});

	// ─── Song queue + auto-start ────────────────────────────────────

	describe("updateQueue", () => {
		it("auto-starts first song when no current song", () => {
			const queue = [song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 })];

			room.updateQueue(queue, 0);

			expect(room.playback.currentSongId).toBe("s-1");
			expect(room.playback.isPlaying).toBe(true);
		});

		it("auto-starts from 10 songs back when queue is long", () => {
			const queue = Array.from({ length: 109 }, (_, i) =>
				song(`s-${i + 1}`, {
					audioUrl: `/a/${i + 1}.mp3`,
					orderIndex: i + 1,
				}),
			);

			room.updateQueue(queue, 0);

			expect(room.playback.currentSongId).toBe("s-99");
			expect(room.playback.isPlaying).toBe(true);
		});

		it("does not auto-start songs without audioUrl", () => {
			const queue = [song("s-1", { status: "pending", orderIndex: 1 })];

			room.updateQueue(queue, 0);

			expect(room.playback.currentSongId).toBeNull();
		});

		it("does not change current song if one is already playing", () => {
			const queue = [song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 })];
			room.updateQueue(queue, 0);
			expect(room.playback.currentSongId).toBe("s-1");

			// Add more songs — should not switch
			const queue2 = [
				...queue,
				song("s-2", { audioUrl: "/a/2.mp3", orderIndex: 2 }),
			];
			room.updateQueue(queue2, 0);
			expect(room.playback.currentSongId).toBe("s-1");
		});
	});

	// ─── Song ended / skip ──────────────────────────────────────────

	describe("handleSongEnded", () => {
		it("advances to next song by orderIndex", () => {
			const queue = [
				song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 }),
				song("s-2", { audioUrl: "/a/2.mp3", orderIndex: 2 }),
				song("s-3", { audioUrl: "/a/3.mp3", orderIndex: 3 }),
			];
			room.updateQueue(queue, 0);
			expect(room.playback.currentSongId).toBe("s-1");

			room.handleSongEnded();
			expect(room.playback.currentSongId).toBe("s-2");
		});

		it("stops playback when no more songs", () => {
			const queue = [song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 })];
			room.updateQueue(queue, 0);

			room.handleSongEnded();

			expect(room.playback.isPlaying).toBe(false);
			expect(room.playback.currentSongId).toBeNull();
		});

		it("debounces rapid calls (only first triggers advance)", () => {
			const queue = [
				song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 }),
				song("s-2", { audioUrl: "/a/2.mp3", orderIndex: 2 }),
				song("s-3", { audioUrl: "/a/3.mp3", orderIndex: 3 }),
			];
			room.updateQueue(queue, 0);

			room.handleSongEnded();
			room.handleSongEnded(); // should be debounced
			room.handleSongEnded(); // should be debounced

			expect(room.playback.currentSongId).toBe("s-2"); // not s-3
		});

		it("skip command advances to next song", () => {
			const queue = [
				song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 }),
				song("s-2", { audioUrl: "/a/2.mp3", orderIndex: 2 }),
			];
			room.updateQueue(queue, 0);
			expect(room.playback.currentSongId).toBe("s-1");

			room.handleCommand("d1", "skip");
			expect(room.playback.currentSongId).toBe("s-2");
		});

		it("calls markPlayed callback for finished song", () => {
			const markPlayed = vi.fn().mockResolvedValue(undefined);
			room = new Room("room-1", "Test Room", "key-1", markPlayed);

			const queue = [
				song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 }),
				song("s-2", { audioUrl: "/a/2.mp3", orderIndex: 2 }),
			];
			room.updateQueue(queue, 0);

			room.handleSongEnded();
			expect(markPlayed).toHaveBeenCalledWith("s-1");
		});
	});

	// ─── Sync from player ───────────────────────────────────────────

	describe("handleSync", () => {
		it("updates playback time and duration", () => {
			room.handleSync("d1", "s-1", true, 30.5, 180);

			expect(room.playback.currentTime).toBe(30.5);
			expect(room.playback.duration).toBe(180);
			expect(room.playback.currentSongId).toBe("s-1");
		});

		it("does not override isPlaying from sync", () => {
			room.playback.isPlaying = true;
			room.handleSync("d1", "s-1", false, 0, 180);

			// Room commands are authoritative for isPlaying, not sync reports
			expect(room.playback.isPlaying).toBe(true);
		});
	});

	// ─── Ping/Pong ──────────────────────────────────────────────────

	describe("ping/pong", () => {
		it("responds to ping with pong", () => {
			const { ws, messages } = createMockWs();
			room.addDevice({ id: "d1", name: "Phone", role: "controller" }, ws);
			// Clear join messages
			messages.length = 0;

			room.handlePing("d1", 1234567890);

			const pong = messages.find((m) => m.type === "pong");
			expect(pong).toMatchObject({
				type: "pong",
				clientTime: 1234567890,
			});
		});
	});

	// ─── Device targeting (individual mode) ─────────────────────────

	describe("device targeting", () => {
		it("targeted command sets device to individual mode", () => {
			const { ws } = createMockWs();
			room.addDevice({ id: "d1", name: "Speaker", role: "player" }, ws);

			room.handleCommand("ctrl", "setVolume", { volume: 0.3 }, "d1");

			const devices = room.getDevices();
			expect(devices[0].mode).toBe("individual");
		});

		it("resetToDefault restores device to default mode", () => {
			const { ws } = createMockWs();
			room.addDevice({ id: "d1", name: "Speaker", role: "player" }, ws);

			// Put in individual mode
			room.handleCommand("ctrl", "setVolume", { volume: 0.3 }, "d1");
			expect(room.getDevices()[0].mode).toBe("individual");

			// Reset to default
			room.handleCommand("ctrl", "resetToDefault", undefined, "d1");
			expect(room.getDevices()[0].mode).toBe("default");
		});

		it("syncAll resets all players to default mode", () => {
			const { ws: ws1 } = createMockWs();
			const { ws: ws2 } = createMockWs();
			room.addDevice({ id: "d1", name: "Speaker 1", role: "player" }, ws1);
			room.addDevice({ id: "d2", name: "Speaker 2", role: "player" }, ws2);

			// Put both in individual mode
			room.handleCommand("ctrl", "setVolume", { volume: 0.3 }, "d1");
			room.handleCommand("ctrl", "setVolume", { volume: 0.5 }, "d2");

			room.handleCommand("ctrl", "syncAll");

			const devices = room.getDevices();
			expect(devices.every((d) => d.mode === "default")).toBe(true);
		});
	});

	// ─── Role switching ─────────────────────────────────────────────

	describe("setDeviceRole", () => {
		it("changes device role and sends song to new player", () => {
			const queue = [song("s-1", { audioUrl: "/a/1.mp3", orderIndex: 1 })];
			room.updateQueue(queue, 0);

			const { ws, messages } = createMockWs();
			room.addDevice({ id: "d1", name: "Phone", role: "controller" }, ws);
			messages.length = 0; // clear join messages

			room.setDeviceRole("d1", "player");

			const nextSong = messages.find((m) => m.type === "nextSong");
			expect(nextSong).toBeDefined();
		});
	});
});
