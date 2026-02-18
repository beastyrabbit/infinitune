import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, setupTestDb, teardownTestDb } from "./test-db";

const emittedEvents: Array<{ event: string; data: unknown }> = [];

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: (event: string, data: unknown) => {
		emittedEvents.push({ event, data });
	},
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

import { playlists } from "../db/schema";
import * as playlistService from "../services/playlist-service";

describe("playlist-service", () => {
	beforeEach(() => {
		setupTestDb();
		emittedEvents.length = 0;
	});

	afterEach(() => {
		teardownTestDb();
	});

	// ─── create ────────────────────────────────────────────────────

	describe("create", () => {
		it("creates a playlist and emits playlist.created", async () => {
			const result = await playlistService.create({
				name: "Test Playlist",
				prompt: "chill lofi beats",
				llmProvider: "ollama",
				llmModel: "llama3",
			});

			expect(result.id).toBeDefined();
			expect(result.name).toBe("Test Playlist");
			expect(result.status).toBe("active");
			expect(result.promptEpoch).toBe(0);
			expect(result.songsGenerated).toBe(0);

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0].event).toBe("playlist.created");
		});

		it("respects optional params", async () => {
			const result = await playlistService.create({
				name: "Custom",
				prompt: "test",
				llmProvider: "openrouter",
				llmModel: "gpt-4",
				mode: "oneshot",
				targetBpm: 140,
				audioDuration: 120,
			});

			expect(result.mode).toBe("oneshot");
			expect(result.targetBpm).toBe(140);
			expect(result.audioDuration).toBe(120);
		});
	});

	describe("updateParams", () => {
		it("resets manager fields when llm provider/model change", async () => {
			const pl = await playlistService.create({
				name: "Manager Reset",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});

			const db = getTestDb();
			await db
				.update(playlists)
				.set({
					managerBrief: "existing brief",
					managerPlan: JSON.stringify({
						strategySummary: "keep vibe",
						transitionPolicy: "smooth",
						avoidPatterns: [],
						slots: [],
					}),
					managerEpoch: 2,
					managerUpdatedAt: Date.now(),
				})
				.where(eq(playlists.id, pl.id));

			emittedEvents.length = 0;
			await playlistService.updateParams(pl.id, {
				llmProvider: "openai-codex",
				llmModel: "",
			});

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));

			expect(updated.llmProvider).toBe("openai-codex");
			expect(updated.llmModel).toBe("");
			expect(updated.managerBrief).toBeNull();
			expect(updated.managerPlan).toBeNull();
			expect(updated.managerEpoch).toBeNull();
			expect(updated.managerUpdatedAt).toBeNull();
			expect(emittedEvents[0]).toMatchObject({
				event: "playlist.updated",
				data: { playlistId: pl.id },
			});
		});

		it("treats null llmModel as empty string fallback", async () => {
			const pl = await playlistService.create({
				name: "Model Fallback",
				prompt: "test",
				llmProvider: "openrouter",
				llmModel: "openai/gpt-4.1",
			});

			const db = getTestDb();
			await db
				.update(playlists)
				.set({
					managerBrief: "existing brief",
					managerPlan: JSON.stringify({
						strategySummary: "keep vibe",
						transitionPolicy: "smooth",
						avoidPatterns: [],
						slots: [],
					}),
					managerEpoch: 1,
					managerUpdatedAt: Date.now(),
				})
				.where(eq(playlists.id, pl.id));

			await playlistService.updateParams(pl.id, { llmModel: null });

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));

			expect(updated.llmModel).toBe("");
			expect(updated.managerBrief).toBeNull();
			expect(updated.managerPlan).toBeNull();
		});
	});

	// ─── updateStatus ──────────────────────────────────────────────

	describe("updateStatus", () => {
		it("transitions active → closing", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});
			emittedEvents.length = 0;

			await playlistService.updateStatus(pl.id, "closing");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.status).toBe("closing");

			expect(emittedEvents[0]).toMatchObject({
				event: "playlist.status_changed",
				data: { from: "active", to: "closing" },
			});
		});

		it("transitions closing → closed", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					status: "closing",
				})
				.returning();

			await playlistService.updateStatus(pl.id, "closed");

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.status).toBe("closed");
		});

		it("rejects invalid transition closed → active", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					status: "closed",
				})
				.returning();

			await expect(
				playlistService.updateStatus(pl.id, "active"),
			).rejects.toThrow("Invalid playlist transition: closed → active");
		});
	});

	// ─── steer ─────────────────────────────────────────────────────

	describe("steer", () => {
		it("bumps epoch and updates prompt", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "original vibe",
				llmProvider: "ollama",
				llmModel: "llama3",
			});
			emittedEvents.length = 0;

			await playlistService.steer(pl.id, "new jazzy vibe");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.prompt).toBe("new jazzy vibe");
			expect(updated.promptEpoch).toBe(1);
			expect(updated.steerHistory).toContain("new jazzy vibe");

			expect(emittedEvents[0]).toMatchObject({
				event: "playlist.steered",
				data: { playlistId: pl.id, newEpoch: 1 },
			});
		});

		it("increments epoch on each steer", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "v1",
				llmProvider: "ollama",
				llmModel: "llama3",
			});

			await playlistService.steer(pl.id, "v2");
			await playlistService.steer(pl.id, "v3");

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.promptEpoch).toBe(2);
		});
	});

	// ─── heartbeat ─────────────────────────────────────────────────

	describe("heartbeat", () => {
		it("updates lastSeenAt timestamp", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});
			emittedEvents.length = 0;

			await playlistService.heartbeat(pl.id);

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.lastSeenAt).toBeGreaterThan(0);

			expect(emittedEvents[0].event).toBe("playlist.heartbeat");
		});

		it("reactivates closing playlist", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					status: "closing",
				})
				.returning();

			await playlistService.heartbeat(pl.id);

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.status).toBe("active");

			// Should emit both heartbeat and status_changed
			const statusEvent = emittedEvents.find(
				(e) => e.event === "playlist.status_changed",
			);
			expect(statusEvent?.data).toMatchObject({
				from: "closing",
				to: "active",
			});
		});

		it("reactivates closed endless playlist", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					status: "closed",
				})
				.returning();

			await playlistService.heartbeat(pl.id);

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.status).toBe("active");

			const statusEvent = emittedEvents.find(
				(e) => e.event === "playlist.status_changed",
			);
			expect(statusEvent?.data).toMatchObject({
				from: "closed",
				to: "active",
			});
		});

		it("does NOT reactivate closed oneshot playlist", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					mode: "oneshot",
					status: "closed",
				})
				.returning();

			await playlistService.heartbeat(pl.id);

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.status).toBe("closed");

			const statusEvent = emittedEvents.find(
				(e) => e.event === "playlist.status_changed",
			);
			expect(statusEvent).toBeUndefined();
		});
	});

	// ─── deletePlaylist ────────────────────────────────────────────

	describe("deletePlaylist", () => {
		it("deletes the playlist and emits playlist.deleted", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});
			emittedEvents.length = 0;

			await playlistService.deletePlaylist(pl.id);

			const db = getTestDb();
			const rows = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(rows).toHaveLength(0);

			expect(emittedEvents[0]).toMatchObject({
				event: "playlist.deleted",
				data: { playlistId: pl.id },
			});
		});
	});

	// ─── toggleStar ───────────────────────────────────────────────

	describe("toggleStar", () => {
		it("toggles false → true", async () => {
			const pl = await playlistService.create({
				name: "Test",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});
			emittedEvents.length = 0;

			const result = await playlistService.toggleStar(pl.id);
			expect(result).toMatchObject({ isStarred: true });

			const db = getTestDb();
			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.isStarred).toBe(true);

			expect(emittedEvents[0]).toMatchObject({
				event: "playlist.updated",
				data: { playlistId: pl.id },
			});
		});

		it("toggles true → false", async () => {
			const db = getTestDb();
			const [pl] = await db
				.insert(playlists)
				.values({
					name: "Test",
					prompt: "test",
					llmProvider: "ollama",
					llmModel: "llama3",
					isStarred: true,
				})
				.returning();

			const result = await playlistService.toggleStar(pl.id);
			expect(result).toMatchObject({ isStarred: false });

			const [updated] = await db
				.select()
				.from(playlists)
				.where(eq(playlists.id, pl.id));
			expect(updated.isStarred).toBe(false);
		});

		it("returns undefined for non-existent playlist", async () => {
			const result = await playlistService.toggleStar("nonexistent");
			expect(result).toBeUndefined();
		});
	});

	// ─── queries ───────────────────────────────────────────────────

	describe("queries", () => {
		it("getCurrent returns an active non-oneshot playlist", async () => {
			const pl = await playlistService.create({
				name: "Active",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
			});

			const current = await playlistService.getCurrent();
			expect(current?.id).toBe(pl.id);
			expect(current?.status).toBe("active");
		});

		it("getCurrent skips oneshot playlists", async () => {
			const endless = await playlistService.create({
				name: "Endless",
				prompt: "endless",
				llmProvider: "ollama",
				llmModel: "llama3",
				mode: "endless",
			});
			await playlistService.create({
				name: "Oneshot",
				prompt: "oneshot",
				llmProvider: "ollama",
				llmModel: "llama3",
				mode: "oneshot",
			});

			const current = await playlistService.getCurrent();
			expect(current?.id).toBe(endless.id);
		});

		it("getByKey finds playlist by key", async () => {
			await playlistService.create({
				name: "Keyed",
				prompt: "test",
				llmProvider: "ollama",
				llmModel: "llama3",
				playlistKey: "my-key",
			});

			const found = await playlistService.getByKey("my-key");
			expect(found?.name).toBe("Keyed");

			const notFound = await playlistService.getByKey("other-key");
			expect(notFound).toBeNull();
		});
	});
});
