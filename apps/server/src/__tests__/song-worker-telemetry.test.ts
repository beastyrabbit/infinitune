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
import * as songService from "../services/song-service";
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

async function createSong(
	status: string,
	retryCount = 0,
	aceTaskId: string | null = null,
) {
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
		.values({
			playlistId: playlist.id,
			orderIndex: 1,
			status,
			retryCount,
			aceTaskId,
		})
		.returning();
	return { playlist, song };
}

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
		const { playlist, song } = await createSong(status, retryCount);
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

it.each([
	["metadata_ready", null],
	["submitting_to_ace", null],
	["generating_audio", null],
	["generating_audio", "old-task"],
	["saving", null],
	["saving", "old-task"],
] as const)(
	"reports ACE failures after recovery from %s with task %s without changing retry state",
	async (status, aceTaskId) => {
		for (const outcome of ["failed", "not_found"]) {
			for (const retryCount of [0, 3]) {
				const { playlist, song } = await createSong(
					status,
					retryCount,
					aceTaskId,
				);
				const result = {
					result: {
						taskId: "task",
						status: outcome,
						error: "Provider failure",
					},
					processingMs: 10,
				};
				const worker = new SongWorker(songToWire(song), {
					playlist: playlistToWire(playlist),
					getPlaylistActive: async () => true,
					queues: {
						audio: {
							enqueue: async () => {
								await songService.updateAceTask(song.id, "task");
								return result;
							},
							resumePoll: async () => result,
						},
					},
				} as unknown as SongWorkerContext);
				await worker.run();
				const expectedStatus = retryCount === 3 ? "error" : "retry_pending";
				expect(emit).toHaveBeenCalledWith("song.status_changed", {
					songId: song.id,
					playlistId: playlist.id,
					from: "metadata_ready",
					to: expectedStatus,
					failure: {
						error: expect.any(Error),
						stage: "generating_audio",
					},
				});
				expect(await songService.getById(song.id)).toMatchObject({
					status: expectedStatus,
					erroredAtStatus: "metadata_ready",
					aceTaskId: null,
					retryCount,
				});
				if (retryCount === 0) {
					await songService.retryErrored(song.id);
					expect(await songService.getById(song.id)).toMatchObject({
						status: "metadata_ready",
						aceTaskId: null,
						retryCount: 1,
					});
				}
			}
		}
	},
);

it.each(["submitting_to_ace", "generating_audio", "saving"])(
	"reports the new submission stage when restarting %s fails before polling",
	async (status) => {
		const { playlist, song } = await createSong(status);
		const error = new TypeError("Submission failure");
		const worker = new SongWorker(songToWire(song), {
			playlist: playlistToWire(playlist),
			getPlaylistActive: async () => true,
			queues: { audio: { enqueue: vi.fn().mockRejectedValue(error) } },
		} as unknown as SongWorkerContext);
		await worker.run();
		expect(emit).toHaveBeenCalledWith("song.status_changed", {
			songId: song.id,
			playlistId: playlist.id,
			from: "submitting_to_ace",
			to: "retry_pending",
			failure: { error, stage: "submitting_to_ace" },
		});
	},
);
