import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../services/song-service", () => ({
	getWorkQueue: vi.fn(),
	getByIds: vi.fn(),
	createPending: vi.fn(),
	deleteSong: vi.fn(),
	retryErrored: vi.fn(),
	getInAudioPipeline: vi.fn(),
	listByPlaylist: vi.fn(),
	getNeedsPersona: vi.fn().mockResolvedValue([]),
	updatePersonaExtract: vi.fn(),
	revertTransient: vi.fn(),
	updateStatus: vi.fn(),
}));

vi.mock("../services/playlist-service", () => ({
	getById: vi.fn(),
	listActive: vi.fn(),
	updateStatus: vi.fn(),
	getByKey: vi.fn(),
}));

vi.mock("../services/settings-service", () => ({
	getAll: vi.fn().mockResolvedValue({
		textProvider: "ollama",
		textModel: "llama3",
		imageProvider: "comfyui",
		personaProvider: "",
		personaModel: "",
	}),
}));

vi.mock("../events/event-bus", () => ({
	emit: vi.fn(),
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

vi.mock("../external/ace", () => ({
	pollAce: vi.fn(),
	batchPollAce: vi.fn(),
}));

vi.mock("./song-worker", () => ({
	SongWorker: vi.fn().mockImplementation(() => ({
		run: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn(),
	})),
}));

vi.mock("./queues", () => ({
	EndpointQueues: vi.fn().mockImplementation(() => ({
		refreshAll: vi.fn(),
		audio: { tickPolls: vi.fn() },
		llm: { enqueue: vi.fn() },
		recalcPendingPriorities: vi.fn(),
	})),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";
import { _test } from "../worker/index";

const {
	checkBufferDeficit,
	handleSongStatusChanged,
	handlePlaylistCreated,
	handlePlaylistDeleted,
	handlePlaylistStatusChanged,
	handlePlaylistHeartbeat,
	handlePlaylistSteered,
	reset,
	setQueues,
	setPlaylistEpoch,
} = _test;

// ─── Helpers ────────────────────────────────────────────────────────

function mockWorkQueue(overrides: Record<string, unknown> = {}) {
	return {
		pending: [],
		metadataReady: [],
		needsCover: [],
		generatingAudio: [],
		retryPending: [],
		needsRecovery: [],
		bufferDeficit: 0,
		maxOrderIndex: 0,
		totalSongs: 0,
		transientCount: 0,
		currentEpoch: 0,
		recentCompleted: [],
		recentDescriptions: [],
		staleSongs: [],
		...overrides,
	};
}

function mockPlaylist(overrides: Record<string, unknown> = {}) {
	return {
		id: "pl-1",
		createdAt: Date.now(),
		name: "Test",
		prompt: "test",
		llmProvider: "ollama",
		llmModel: "llama3",
		mode: "endless",
		status: "active",
		songsGenerated: 0,
		promptEpoch: 0,
		currentOrderIndex: 0,
		playlistKey: null,
		lyricsLanguage: null,
		targetBpm: null,
		targetKey: null,
		timeSignature: null,
		audioDuration: null,
		inferenceSteps: null,
		lmTemperature: null,
		lmCfgScale: null,
		inferMethod: null,
		lastSeenAt: null,
		steerHistory: null,
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("worker event handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		reset();
		setQueues({
			recalcPendingPriorities: vi.fn(),
			refreshAll: vi.fn(),
			audio: { tickPolls: vi.fn() },
			llm: { enqueue: vi.fn() },
		} as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ─── checkBufferDeficit ─────────────────────────────────────────

	describe("checkBufferDeficit", () => {
		it("creates songs when buffer has deficit", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 3, maxOrderIndex: 2 }),
			);

			await checkBufferDeficit("pl-1");

			expect(songService.createPending).toHaveBeenCalledTimes(3);
			expect(songService.createPending).toHaveBeenCalledWith("pl-1", 3, {
				promptEpoch: 0,
			});
			expect(songService.createPending).toHaveBeenCalledWith("pl-1", 4, {
				promptEpoch: 0,
			});
			expect(songService.createPending).toHaveBeenCalledWith("pl-1", 5, {
				promptEpoch: 0,
			});
		});

		it("does nothing when buffer is full", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 0 }),
			);

			await checkBufferDeficit("pl-1");

			expect(songService.createPending).not.toHaveBeenCalled();
		});

		it("does nothing for inactive playlists", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ status: "closed" }),
			);

			await checkBufferDeficit("pl-1");

			expect(songService.getWorkQueue).not.toHaveBeenCalled();
		});

		it("does nothing for missing playlists", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(null);

			await checkBufferDeficit("pl-1");

			expect(songService.getWorkQueue).not.toHaveBeenCalled();
		});

		it("prevents concurrent buffer checks (buffer lock)", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 2, maxOrderIndex: 0 }),
			);

			// Start two concurrent checks
			const p1 = checkBufferDeficit("pl-1");
			const p2 = checkBufferDeficit("pl-1");
			await Promise.all([p1, p2]);

			// Only one should have run (the second one returns early)
			expect(songService.getWorkQueue).toHaveBeenCalledTimes(1);
		});

		it("creates exactly 1 song for oneshot mode", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ mode: "oneshot" }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ totalSongs: 0, maxOrderIndex: 0 }),
			);

			await checkBufferDeficit("pl-1");

			expect(songService.createPending).toHaveBeenCalledTimes(1);
		});

		it("auto-closes oneshot playlist when complete", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ mode: "oneshot" }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ totalSongs: 1, transientCount: 0 }),
			);

			await checkBufferDeficit("pl-1");

			expect(playlistService.updateStatus).toHaveBeenCalledWith(
				"pl-1",
				"closing",
			);
		});
	});

	// ─── handleSongStatusChanged ────────────────────────────────────

	describe("handleSongStatusChanged", () => {
		it("checks buffer deficit when song becomes ready", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 1, maxOrderIndex: 5 }),
			);

			await handleSongStatusChanged({
				songId: "s-1",
				playlistId: "pl-1",
				from: "saving",
				to: "ready",
			});

			expect(songService.createPending).toHaveBeenCalled();
		});

		it("auto-retries songs entering retry_pending", async () => {
			await handleSongStatusChanged({
				songId: "s-1",
				playlistId: "pl-1",
				from: "error",
				to: "retry_pending",
			});

			expect(songService.retryErrored).toHaveBeenCalledWith("s-1");
		});

		it("closes playlist when last transient song finishes (closing)", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ status: "closing" }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ transientCount: 0 }),
			);

			await handleSongStatusChanged({
				songId: "s-1",
				playlistId: "pl-1",
				from: "saving",
				to: "ready",
			});

			expect(playlistService.updateStatus).toHaveBeenCalledWith(
				"pl-1",
				"closed",
			);
		});

		it("does NOT close playlist when transient work remains", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ status: "closing" }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ transientCount: 2 }),
			);

			await handleSongStatusChanged({
				songId: "s-1",
				playlistId: "pl-1",
				from: "saving",
				to: "ready",
			});

			expect(playlistService.updateStatus).not.toHaveBeenCalledWith(
				"pl-1",
				"closed",
			);
		});
	});

	// ─── handlePlaylistCreated ──────────────────────────────────────

	describe("handlePlaylistCreated", () => {
		it("sets epoch and creates initial buffer", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ promptEpoch: 3 }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 5, maxOrderIndex: 0 }),
			);

			await handlePlaylistCreated({ playlistId: "pl-1" });

			// Should create 5 pending songs for the initial buffer
			expect(songService.createPending).toHaveBeenCalledTimes(5);
		});

		it("skips inactive playlists", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ status: "closed" }),
			);

			await handlePlaylistCreated({ playlistId: "pl-1" });

			expect(songService.getWorkQueue).not.toHaveBeenCalled();
		});

		it("skips missing playlists", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(null);

			await handlePlaylistCreated({ playlistId: "pl-1" });

			expect(songService.getWorkQueue).not.toHaveBeenCalled();
		});
	});

	// ─── handlePlaylistHeartbeat ────────────────────────────────────

	describe("handlePlaylistHeartbeat", () => {
		it("resets heartbeat timer — stale timeout fires after 90s", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());

			// First heartbeat starts the timer
			await handlePlaylistHeartbeat({ playlistId: "pl-1" });

			// Advance close to 90s — should not have fired yet
			await vi.advanceTimersByTimeAsync(89_000);
			expect(playlistService.updateStatus).not.toHaveBeenCalled();

			// Advance past 90s — should fire
			await vi.advanceTimersByTimeAsync(2_000);
			expect(playlistService.updateStatus).toHaveBeenCalledWith(
				"pl-1",
				"closing",
			);
		});

		it("resets timer on each heartbeat", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());

			await handlePlaylistHeartbeat({ playlistId: "pl-1" });
			await vi.advanceTimersByTimeAsync(60_000); // 60s
			// Send another heartbeat — resets the 90s timer
			await handlePlaylistHeartbeat({ playlistId: "pl-1" });
			await vi.advanceTimersByTimeAsync(60_000); // 60s more (120s total)

			// Should not have fired because timer was reset
			expect(playlistService.updateStatus).not.toHaveBeenCalled();

			// Advance past the reset timer
			await vi.advanceTimersByTimeAsync(31_000);
			expect(playlistService.updateStatus).toHaveBeenCalledWith(
				"pl-1",
				"closing",
			);
		});
	});

	// ─── handlePlaylistDeleted ──────────────────────────────────────

	describe("handlePlaylistDeleted", () => {
		it("cleans up all state for the playlist", async () => {
			// Set up some state first
			setPlaylistEpoch("pl-1", 5);
			await handlePlaylistHeartbeat({ playlistId: "pl-1" }); // creates timer

			await handlePlaylistDeleted({ playlistId: "pl-1" });

			// Advance timer — should NOT fire (was cleared)
			vi.mocked(playlistService.updateStatus).mockClear();
			await vi.advanceTimersByTimeAsync(100_000);
			expect(playlistService.updateStatus).not.toHaveBeenCalled();
		});
	});

	// ─── handlePlaylistStatusChanged ────────────────────────────────

	describe("handlePlaylistStatusChanged", () => {
		it("auto-closes immediately when closing with no transient work", async () => {
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ transientCount: 0 }),
			);

			await handlePlaylistStatusChanged({
				playlistId: "pl-1",
				from: "active",
				to: "closing",
			});

			expect(playlistService.updateStatus).toHaveBeenCalledWith(
				"pl-1",
				"closed",
			);
		});

		it("does NOT auto-close when transient work remains", async () => {
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ transientCount: 3 }),
			);

			await handlePlaylistStatusChanged({
				playlistId: "pl-1",
				from: "active",
				to: "closing",
			});

			expect(playlistService.updateStatus).not.toHaveBeenCalledWith(
				"pl-1",
				"closed",
			);
		});

		it("re-checks buffer on reactivation (closing → active)", async () => {
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({ bufferDeficit: 2, maxOrderIndex: 3 }),
			);

			await handlePlaylistStatusChanged({
				playlistId: "pl-1",
				from: "closing",
				to: "active",
			});

			expect(songService.createPending).toHaveBeenCalledTimes(2);
		});
	});

	// ─── handlePlaylistSteered ──────────────────────────────────────

	describe("handlePlaylistSteered", () => {
		it("deletes old-epoch pending songs", async () => {
			setPlaylistEpoch("pl-1", 0);
			vi.mocked(playlistService.getById).mockResolvedValue(
				mockPlaylist({ mode: "endless", status: "active" }),
			);
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({
					bufferDeficit: 2,
					maxOrderIndex: 5,
					pending: [
						{
							_id: "old-1",
							promptEpoch: 0,
							isInterrupt: false,
							orderIndex: 1,
						},
						{
							_id: "old-2",
							promptEpoch: 0,
							isInterrupt: false,
							orderIndex: 2,
						},
					],
				}),
			);

			await handlePlaylistSteered({ playlistId: "pl-1", newEpoch: 1 });

			expect(songService.deleteSong).toHaveBeenCalledWith("old-1");
			expect(songService.deleteSong).toHaveBeenCalledWith("old-2");
		});

		it("preserves interrupt songs during epoch change", async () => {
			setPlaylistEpoch("pl-1", 0);
			vi.mocked(playlistService.getById).mockResolvedValue(mockPlaylist());
			vi.mocked(songService.getWorkQueue).mockResolvedValue(
				mockWorkQueue({
					pending: [
						{
							_id: "int-1",
							promptEpoch: 0,
							isInterrupt: true,
							interruptPrompt: "play jazz",
							orderIndex: 1,
						},
					],
				}),
			);

			await handlePlaylistSteered({ playlistId: "pl-1", newEpoch: 1 });

			expect(songService.deleteSong).not.toHaveBeenCalledWith("int-1");
		});

		it("skips when epoch has not advanced", async () => {
			setPlaylistEpoch("pl-1", 3);

			await handlePlaylistSteered({ playlistId: "pl-1", newEpoch: 2 });

			expect(playlistService.getById).not.toHaveBeenCalled();
		});
	});
});
