import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
vi.mock("../events/event-bus", () => ({ emit: vi.fn(), on: vi.fn() }));

import { playlists, songs } from "../db/schema";
import { emit } from "../events/event-bus";
import { playlistToWire, songToWire } from "../wire";
import { SongWorker, type SongWorkerContext } from "../worker/song-worker";

beforeEach(() => {
	setupTestDb();
	vi.clearAllMocks();
});
afterEach(() => {
	vi.restoreAllMocks();
	teardownTestDb();
});

it.each([
	["generating_metadata", 0],
	["generating_metadata", 3],
	["generating_audio", 0],
	["generating_audio", 3],
	["saving", 0],
	["saving", 3],
] as const)(
	"preserves the original %s exception through the worker and status event at retry count %i",
	async (status, retryCount) => {
		const db = getTestDb();
		const [playlist] = await db
			.insert(playlists)
			.values({
				name: "Test",
				prompt: "ambient",
				llmProvider: "ollama",
				llmModel: "test-model",
				mode: "endless",
				status: "active",
			})
			.returning();
		const [song] = await db
			.insert(songs)
			.values({ playlistId: playlist.id, orderIndex: 1, status, retryCount })
			.returning();
		const worker = new SongWorker(songToWire(song), {
			playlist: playlistToWire(playlist),
		} as SongWorkerContext);
		const error = new TypeError(`${status} failure`);
		// Stub only the stage's external work; run the real XState failure path,
		// markError database update and event emission.
		const stages = worker as unknown as {
			runMetadataStage(): Promise<void>;
			runAudioStage(): Promise<void>;
		};
		vi.spyOn(
			stages,
			status === "generating_metadata" ? "runMetadataStage" : "runAudioStage",
		).mockRejectedValue(error);
		await worker.run();
		expect(emit).toHaveBeenCalledExactlyOnceWith("song.status_changed", {
			songId: song.id,
			playlistId: playlist.id,
			from: status,
			to: retryCount === 3 ? "error" : "retry_pending",
			failure: { error, stage: status },
		});
		expect(vi.mocked(emit).mock.calls[0][1]).toHaveProperty(
			"failure.error",
			error,
		);
	},
);
