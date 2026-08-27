import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

vi.mock("../auth/actor", () => ({
	getRequestActor: vi.fn(),
}));

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

vi.mock("../utils/song-audio-path", () => ({
	resolveSongAudioFile: vi.fn((storagePath: string | null | undefined) =>
		storagePath ? `${storagePath}/audio.mp3` : null,
	),
}));

import { getRequestActor } from "../auth/actor";
import { playlists, songs, users } from "../db/schema";
import { resetRateLimiters } from "../middleware/rate-limit";
import songsRoutes from "../routes/songs/index";

async function seedOwnedSongs() {
	const db = getTestDb();
	const now = Date.now();
	await db.insert(users).values([
		{
			id: "user-1",
			createdAt: now,
			shooSubject: "shoo-user-1",
		},
		{
			id: "user-2",
			createdAt: now,
			shooSubject: "shoo-user-2",
		},
	]);
	await db.insert(playlists).values([
		{
			id: "public-playlist",
			createdAt: now,
			name: "Public",
			prompt: "public",
			llmProvider: "openai-codex",
			llmModel: "",
		},
		{
			id: "owned-playlist",
			createdAt: now + 1,
			name: "Owned",
			prompt: "private",
			llmProvider: "openai-codex",
			llmModel: "",
			ownerUserId: "user-1",
		},
		{
			id: "other-playlist",
			createdAt: now + 2,
			name: "Other",
			prompt: "other private",
			llmProvider: "openai-codex",
			llmModel: "",
			ownerUserId: "user-2",
		},
	]);
	await db.insert(songs).values([
		{
			id: "public-song",
			createdAt: now,
			playlistId: "public-playlist",
			orderIndex: 1,
			status: "generating_audio",
			title: "Public Song",
			userRating: "up",
			storagePath: "/music/public",
		},
		{
			id: "owned-song",
			createdAt: now + 1,
			playlistId: "owned-playlist",
			orderIndex: 1,
			status: "generating_audio",
			title: "Owned Song",
			userRating: "up",
			storagePath: "/music/owned",
		},
		{
			id: "other-song",
			createdAt: now + 2,
			playlistId: "other-playlist",
			orderIndex: 1,
			status: "generating_audio",
			title: "Other Song",
			userRating: "up",
			storagePath: "/music/other",
		},
	]);
}

async function responseIds(response: Response): Promise<string[]> {
	const body = (await response.json()) as Array<{ id: string }>;
	return body.map(({ id }) => id).sort();
}

function postJson(path: string, body: unknown) {
	return songsRoutes.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

const completeMetadata = {
	title: "New Song",
	artistName: "Tester",
	genre: "electronic",
	subGenre: "ambient",
	lyrics: "test lyrics",
	caption: "ambient electronic",
	bpm: 100,
	keyScale: "C major",
	timeSignature: "4/4",
	audioDuration: 180,
};

describe("song route ownership", () => {
	beforeEach(async () => {
		resetRateLimiters();
		setupTestDb();
		await seedOwnedSongs();
		vi.mocked(getRequestActor).mockResolvedValue({ kind: "anonymous" });
	});

	afterEach(() => {
		resetRateLimiters();
		teardownTestDb();
	});

	it("filters aggregate reads and guards playlist-scoped reads", async () => {
		expect(await responseIds(await songsRoutes.request("/"))).toEqual([
			"public-song",
		]);
		expect(
			await responseIds(
				await postJson("/batch", {
					ids: ["public-song", "owned-song", "other-song"],
				}),
			),
		).toEqual(["public-song"]);
		expect(
			await responseIds(await songsRoutes.request("/in-audio-pipeline")),
		).toEqual(["public-song"]);
		expect(
			await responseIds(await songsRoutes.request("/needs-persona")),
		).toEqual(["public-song"]);

		for (const path of [
			"/by-playlist/owned-playlist",
			"/queue/owned-playlist",
			"/next-order-index/owned-playlist",
			"/work-queue/owned-playlist",
		]) {
			expect((await songsRoutes.request(path)).status).toBe(404);
		}

		vi.mocked(getRequestActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		expect(await responseIds(await songsRoutes.request("/"))).toEqual([
			"owned-song",
			"public-song",
		]);
		expect(
			await responseIds(
				await postJson("/batch", {
					ids: ["public-song", "owned-song", "other-song"],
				}),
			),
		).toEqual(["owned-song", "public-song"]);
		expect((await songsRoutes.request("/queue/owned-playlist")).status).toBe(
			200,
		);
	});

	it("prevents callers from inserting songs into another user's playlist", async () => {
		const requests = [
			{
				path: "/",
				body: {
					playlistId: "owned-playlist",
					orderIndex: 2,
					...completeMetadata,
				},
			},
			{
				path: "/create-pending",
				body: { playlistId: "owned-playlist", orderIndex: 3 },
			},
			{
				path: "/create-metadata-ready",
				body: {
					playlistId: "owned-playlist",
					orderIndex: 4,
					...completeMetadata,
				},
			},
		];

		for (const request of requests) {
			expect((await postJson(request.path, request.body)).status).toBe(404);
		}
		expect(
			await getTestDb()
				.select()
				.from(songs)
				.where(eq(songs.playlistId, "owned-playlist")),
		).toHaveLength(1);

		vi.mocked(getRequestActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		for (const request of requests) {
			expect((await postJson(request.path, request.body)).status).toBe(200);
		}
		expect(
			await getTestDb()
				.select()
				.from(songs)
				.where(eq(songs.playlistId, "owned-playlist")),
		).toHaveLength(4);
	});

	it("guards reimagine sources and owns authenticated temporary outputs", async () => {
		const body = {
			sourceSongId: "owned-song",
			style: "minimal synth",
		};
		expect((await postJson("/reimagine", body)).status).toBe(404);

		vi.mocked(getRequestActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		const reimagineResponse = await postJson("/reimagine", body);
		expect(reimagineResponse.status).toBe(200);
		const reimagined = (await reimagineResponse.json()) as {
			playlist: { id: string };
		};
		expect(
			(
				await getTestDb()
					.select()
					.from(playlists)
					.where(eq(playlists.id, reimagined.playlist.id))
			)[0]?.ownerUserId,
		).toBe("user-1");

		const oneshotResponse = await postJson("/oneshot-raw", {
			lyrics: "A private song",
		});
		expect(oneshotResponse.status).toBe(200);
		const oneshot = (await oneshotResponse.json()) as {
			playlist: { id: string };
		};
		expect(
			(
				await getTestDb()
					.select()
					.from(playlists)
					.where(eq(playlists.id, oneshot.playlist.id))
			)[0]?.ownerUserId,
		).toBe("user-1");
	});
});
