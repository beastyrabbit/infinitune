import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

// Track emitted events
const emittedEvents: Array<{ event: string; data: unknown }> = [];

// Mock db/index to use in-memory database
vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

// Mock event bus to capture emitted events
vi.mock("../events/event-bus", () => ({
	emit: (event: string, data: unknown) => {
		emittedEvents.push({ event, data });
	},
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

// Import after mocks are set up
import { playlists, songs } from "../db/schema";
import * as songService from "../services/song-service";

async function createTestPlaylist(overrides?: Record<string, unknown>) {
	const db = getTestDb();
	const [row] = await db
		.insert(playlists)
		.values({
			name: "Test Playlist",
			prompt: "test prompt",
			llmProvider: "ollama",
			llmModel: "llama3",
			mode: "endless",
			status: "active",
			songsGenerated: 0,
			promptEpoch: 0,
			...overrides,
		})
		.returning();
	return row;
}

async function createTestSong(
	playlistId: string,
	orderIndex: number,
	overrides?: Record<string, unknown>,
) {
	const db = getTestDb();
	const [row] = await db
		.insert(songs)
		.values({
			playlistId,
			orderIndex,
			status: "pending",
			...overrides,
		})
		.returning();
	return row;
}

describe("song-service", () => {
	beforeEach(() => {
		setupTestDb();
		emittedEvents.length = 0;
	});

	afterEach(() => {
		teardownTestDb();
	});

	// ─── createPending ─────────────────────────────────────────────

	describe("createPending", () => {
		it("creates a pending song and emits song.created", async () => {
			const pl = await createTestPlaylist();
			const result = await songService.createPending(pl.id, 1);

			expect(result._id).toBeDefined();
			expect(result.status).toBe("pending");
			expect(result.orderIndex).toBe(1);
			expect(result.playlistId).toBe(pl.id);

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0].event).toBe("song.created");
			expect(emittedEvents[0].data).toMatchObject({
				songId: result._id,
				playlistId: pl.id,
				status: "pending",
			});
		});

		it("creates an interrupt song with prompt", async () => {
			const pl = await createTestPlaylist();
			const result = await songService.createPending(pl.id, 1, {
				isInterrupt: true,
				interruptPrompt: "play something jazzy",
			});

			expect(result.isInterrupt).toBe(true);
			expect(result.interruptPrompt).toBe("play something jazzy");
		});
	});

	// ─── createWithMetadata ────────────────────────────────────────

	describe("createWithMetadata", () => {
		it("creates a song with metadata_ready status", async () => {
			const pl = await createTestPlaylist();
			const result = await songService.createWithMetadata(pl.id, 1, {
				title: "Test Song",
				artistName: "Test Artist",
				genre: "Rock",
				subGenre: "Indie Rock",
				bpm: 120,
			});

			expect(result.status).toBe("metadata_ready");
			expect(result.title).toBe("Test Song");
			expect(result.genre).toBe("Rock");
			expect(result.bpm).toBe(120);

			expect(emittedEvents[0].event).toBe("song.created");
			expect(emittedEvents[0].data).toMatchObject({
				status: "metadata_ready",
			});
		});
	});

	// ─── claimMetadata ─────────────────────────────────────────────

	describe("claimMetadata", () => {
		it("claims a pending song for metadata generation", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "pending" });

			const claimed = songService.claimMetadata(song.id);
			expect(claimed).toBe(true);

			// Verify status changed in DB
			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("generating_metadata");

			expect(emittedEvents[0]).toMatchObject({
				event: "song.status_changed",
				data: { songId: song.id, from: "pending", to: "generating_metadata" },
			});
		});

		it("returns false for non-pending songs", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_metadata",
			});

			expect(songService.claimMetadata(song.id)).toBe(false);
			expect(emittedEvents).toHaveLength(0);
		});

		it("returns false for non-existent songs", () => {
			expect(songService.claimMetadata("nonexistent")).toBe(false);
		});
	});

	// ─── claimAudio ────────────────────────────────────────────────

	describe("claimAudio", () => {
		it("claims a metadata_ready song for audio generation", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "metadata_ready" });

			const claimed = songService.claimAudio(song.id);
			expect(claimed).toBe(true);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("submitting_to_ace");

			expect(emittedEvents[0].data).toMatchObject({
				from: "metadata_ready",
				to: "submitting_to_ace",
			});
		});

		it("returns false for non-metadata_ready songs", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "pending" });

			expect(songService.claimAudio(song.id)).toBe(false);
		});
	});

	// ─── updateStatus ──────────────────────────────────────────────

	describe("updateStatus", () => {
		it("updates status with valid transition", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "ready" });

			await songService.updateStatus(song.id, "played");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("played");

			expect(emittedEvents[0]).toMatchObject({
				event: "song.status_changed",
				data: { from: "ready", to: "played" },
			});
		});

		it("rejects invalid status transition", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "pending" });

			await expect(songService.updateStatus(song.id, "ready")).rejects.toThrow(
				"Invalid song transition: pending → ready",
			);

			// Status should remain unchanged
			const db = getTestDb();
			const [unchanged] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(unchanged.status).toBe("pending");
		});

		it("does nothing for non-existent songs", async () => {
			await songService.updateStatus("nonexistent", "played");
			expect(emittedEvents).toHaveLength(0);
		});
	});

	// ─── markReady ─────────────────────────────────────────────────

	describe("markReady", () => {
		it("marks a song as ready with audio URL", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "saving" });

			await songService.markReady(song.id, "http://audio.mp3", 5000);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("ready");
			expect(updated.audioUrl).toBe("http://audio.mp3");
			expect(updated.audioProcessingMs).toBe(5000);
			expect(updated.generationCompletedAt).toBeGreaterThan(0);
		});
	});

	// ─── markError ─────────────────────────────────────────────────

	describe("markError", () => {
		it("marks as retry_pending when retryCount < 3", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_metadata",
				retryCount: 0,
			});

			await songService.markError(song.id, "LLM timeout");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("retry_pending");
			expect(updated.errorMessage).toBe("LLM timeout");
		});

		it("marks as error when retryCount >= 3", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_metadata",
				retryCount: 3,
			});

			await songService.markError(song.id, "LLM timeout");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("error");
		});
	});

	// ─── retryErrored ──────────────────────────────────────────────

	describe("retryErrored", () => {
		it("reverts to pending when errored at metadata stage", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "retry_pending",
				erroredAtStatus: "generating_metadata",
				retryCount: 1,
			});

			await songService.retryErrored(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("pending");
			expect(updated.retryCount).toBe(2);
			expect(updated.errorMessage).toBeNull();
		});

		it("reverts to metadata_ready when errored at audio stage", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "retry_pending",
				erroredAtStatus: "generating_audio",
				retryCount: 0,
			});

			await songService.retryErrored(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("metadata_ready");
		});

		it("does nothing for non-retry_pending songs", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "pending" });

			await songService.retryErrored(song.id);
			expect(emittedEvents).toHaveLength(0);
		});
	});

	// ─── revertTransient ───────────────────────────────────────────

	describe("revertTransient", () => {
		it("reverts generating_metadata to pending", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_metadata",
			});

			await songService.revertTransient(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("pending");
		});

		it("reverts submitting_to_ace to metadata_ready", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "submitting_to_ace",
			});

			await songService.revertTransient(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("metadata_ready");
		});

		it("reverts generating_audio to metadata_ready", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_audio",
			});

			await songService.revertTransient(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("metadata_ready");
		});

		it("reverts saving to metadata_ready", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "saving" });

			await songService.revertTransient(song.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("metadata_ready");
		});

		it("does nothing for ready/played/error songs", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "ready" });

			await songService.revertTransient(song.id);
			expect(emittedEvents).toHaveLength(0);
		});
	});

	// ─── deleteSong ────────────────────────────────────────────────

	describe("deleteSong", () => {
		it("deletes a song and emits song.deleted", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1);

			await songService.deleteSong(song.id);

			const db = getTestDb();
			const rows = await db.select().from(songs).where(eq(songs.id, song.id));
			expect(rows).toHaveLength(0);

			expect(emittedEvents[0]).toMatchObject({
				event: "song.deleted",
				data: { songId: song.id, playlistId: pl.id },
			});
		});
	});

	// ─── rateSong ──────────────────────────────────────────────────

	describe("rateSong", () => {
		it("sets rating on a song", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, { status: "ready" });

			await songService.rateSong(song.id, "up");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.userRating).toBe("up");
		});

		it("toggles rating off when same rating applied", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "ready",
				userRating: "up",
			});

			await songService.rateSong(song.id, "up");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.userRating).toBeNull();
		});
	});

	// ─── completeMetadata ──────────────────────────────────────────

	describe("completeMetadata", () => {
		it("updates metadata and transitions to metadata_ready", async () => {
			const pl = await createTestPlaylist();
			const song = await createTestSong(pl.id, 1, {
				status: "generating_metadata",
			});

			await songService.completeMetadata(song.id, {
				title: "Finished Song",
				artistName: "The Artist",
				genre: "Pop",
				subGenre: "Synth Pop",
				bpm: 128,
				keyScale: "C major",
			});

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(songs)
				.where(eq(songs.id, song.id));
			expect(updated.status).toBe("metadata_ready");
			expect(updated.title).toBe("Finished Song");
			expect(updated.bpm).toBe(128);

			expect(emittedEvents[0]).toMatchObject({
				event: "song.status_changed",
				data: { from: "generating_metadata", to: "metadata_ready" },
			});
		});
	});

	// ─── getWorkQueue ──────────────────────────────────────────────

	describe("getWorkQueue", () => {
		it("returns correct buffer deficit", async () => {
			const pl = await createTestPlaylist({ currentOrderIndex: 0 });

			// Create 3 ready songs ahead — deficit should be 2 (5 - 3)
			await createTestSong(pl.id, 1, { status: "ready" });
			await createTestSong(pl.id, 2, { status: "ready" });
			await createTestSong(pl.id, 3, { status: "ready" });

			const queue = await songService.getWorkQueue(pl.id);
			expect(queue.bufferDeficit).toBe(2);
			expect(queue.totalSongs).toBe(3);
		});

		it("counts transient statuses correctly", async () => {
			const pl = await createTestPlaylist();

			await createTestSong(pl.id, 1, { status: "pending" });
			await createTestSong(pl.id, 2, { status: "generating_metadata" });
			await createTestSong(pl.id, 3, { status: "generating_audio" });
			await createTestSong(pl.id, 4, { status: "ready" });

			const queue = await songService.getWorkQueue(pl.id);
			expect(queue.pending).toHaveLength(1);
			expect(queue.generatingAudio).toHaveLength(1);
			expect(queue.transientCount).toBe(2); // generating_metadata, generating_audio
		});
	});
});
