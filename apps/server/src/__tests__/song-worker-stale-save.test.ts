import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: vi.fn(),
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

const { saveSongToNfsMock } = vi.hoisted(() => ({
	saveSongToNfsMock: vi.fn(),
}));

vi.mock("../external/storage", () => ({
	saveSongToNfs: saveSongToNfsMock,
}));

import { playlists, songs } from "../db/schema";
import * as songService from "../services/song-service";
import { playlistToWire, songToWire } from "../wire";
import { SongWorker, type SongWorkerContext } from "../worker/song-worker";

describe("SongWorker cancelled during the NFS save", () => {
	beforeEach(() => {
		setupTestDb();
		saveSongToNfsMock.mockReset();
	});

	afterEach(() => {
		teardownTestDb();
	});

	it("does not write storage metadata or finalize after cancellation", async () => {
		const db = getTestDb();
		const [playlist] = await db
			.insert(playlists)
			.values({
				name: "Stale save",
				prompt: "ambient",
				llmProvider: "openrouter",
				llmModel: "auto",
				mode: "endless",
				status: "active",
				songsGenerated: 0,
				promptEpoch: 0,
				isTemporary: false,
			})
			.returning();
		const [song] = await db
			.insert(songs)
			.values({
				playlistId: playlist.id,
				orderIndex: 1,
				status: "saving",
				title: "Stale Save",
				artistName: "Infinitune",
				genre: "ambient",
				aceTaskId: "task-old",
			})
			.returning();

		let finishSave: (value: { storagePath: string }) => void = () => {};
		saveSongToNfsMock.mockReturnValue(
			new Promise((resolve) => {
				finishSave = resolve;
			}),
		);
		const worker = new SongWorker(songToWire(song), {
			queues: { cancelAllForSong: vi.fn() },
			playlist: playlistToWire(playlist),
			recentSongs: [],
			recentDescriptions: [],
			getPlaylistActive: async () => true,
			getSettings: async () => ({}),
			capabilities: {},
		} as unknown as SongWorkerContext);

		// biome-ignore lint/complexity/useLiteralKeys: bracket access reaches the private save step under test
		const saving = worker["saveAndFinalize"]("/ace/audio.mp3", 10, "task-old");
		await vi.waitFor(() => expect(saveSongToNfsMock).toHaveBeenCalled());
		worker.cancel();
		finishSave({ storagePath: "/music/stale-generation" });
		await saving;

		const row = await songService.getById(song.id);
		expect(row?.storagePath).toBeNull();
		expect(row?.status).toBe("saving");
	});
});
