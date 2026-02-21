import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/playlist-service", () => ({
	getByKey: vi.fn(),
	getById: vi.fn(),
	heartbeat: vi.fn(),
	updatePosition: vi.fn(),
}));

vi.mock("../services/song-service", () => ({
	listByPlaylist: vi.fn(),
	getWorkQueue: vi.fn(),
	createPending: vi.fn(),
}));

import { Room } from "../room/room";
import { syncRoom } from "../room/room-event-handler";
import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";

function makeSong(orderIndex: number) {
	return {
		id: `s-${orderIndex}`,
		title: `Song ${orderIndex}`,
		artistName: "Test Artist",
		genre: "test",
		subGenre: "test",
		coverUrl: undefined,
		audioUrl: `/audio/${orderIndex}.mp3`,
		status: "ready",
		orderIndex,
		isInterrupt: false,
		promptEpoch: 0,
		createdAt: Date.now(),
		audioDuration: 180,
		mood: undefined,
		energy: undefined,
		era: undefined,
		vocalStyle: undefined,
		userRating: undefined,
		bpm: undefined,
		keyScale: undefined,
		lyrics: undefined,
	};
}

describe("syncRoom", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(playlistService.getByKey).mockResolvedValue({
			id: "pl-1",
			promptEpoch: 0,
		} as never);
		vi.mocked(playlistService.heartbeat).mockResolvedValue(undefined);
		vi.mocked(playlistService.updatePosition).mockResolvedValue(undefined);
		vi.mocked(songService.getWorkQueue).mockResolvedValue({
			maxOrderIndex: 109,
		} as never);
		vi.mocked(songService.createPending).mockResolvedValue({} as never);
	});

	it("seeds idle rooms from 10 songs back and queues +5 songs", async () => {
		const room = new Room("room-1", "Test Room", "playlist-key");
		vi.mocked(songService.listByPlaylist).mockResolvedValue(
			Array.from({ length: 109 }, (_, i) => makeSong(i + 1)) as never,
		);

		await syncRoom(room);

		expect(room.playback.currentSongId).toBe("s-99");
		expect(playlistService.updatePosition).toHaveBeenCalledWith("pl-1", 99);
		expect(songService.createPending).toHaveBeenCalledTimes(5);
		expect(songService.createPending).toHaveBeenNthCalledWith(1, "pl-1", 110, {
			promptEpoch: 0,
		});
		expect(songService.createPending).toHaveBeenNthCalledWith(5, "pl-1", 114, {
			promptEpoch: 0,
		});
	});

	it("does not re-prime when room already has a current song", async () => {
		const room = new Room("room-1", "Test Room", "playlist-key");
		const songs = Array.from({ length: 12 }, (_, i) => makeSong(i + 1));
		room.updateQueue(
			songs.map((song) => ({
				...song,
				status: "ready",
				createdAt: Date.now(),
			})),
			0,
		);

		vi.mocked(songService.listByPlaylist).mockResolvedValue(songs as never);

		await syncRoom(room);

		expect(playlistService.updatePosition).not.toHaveBeenCalled();
		expect(songService.createPending).not.toHaveBeenCalled();
	});
});
