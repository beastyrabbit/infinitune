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

vi.mock("../auth/device", () => ({
	getDeviceActor: vi.fn(),
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
import { getDeviceActor } from "../auth/device";
import { playlists, songs, users } from "../db/schema";
import { resetRateLimiters } from "../middleware/rate-limit";
import agentMemoryRoutes from "../routes/agent-memory";
import playlistsRoutes from "../routes/playlists";
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
			playlistKey: "public",
			prompt: "public",
			llmProvider: "openai-codex",
			llmModel: "",
		},
		{
			id: "owned-playlist",
			createdAt: now + 1,
			name: "Owned",
			playlistKey: "owned",
			prompt: "private",
			llmProvider: "openai-codex",
			llmModel: "",
			ownerUserId: "user-1",
		},
		{
			id: "other-playlist",
			createdAt: now + 2,
			name: "Other",
			playlistKey: "other",
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
			status: "ready",
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

function patchJson(app: typeof songsRoutes, path: string, body: unknown) {
	return app.request(path, {
		method: "PATCH",
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
		vi.mocked(getDeviceActor).mockResolvedValue(null);
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

	it("limits owner devices to local playback operations", async () => {
		vi.mocked(getDeviceActor).mockResolvedValue({
			kind: "device",
			deviceId: "device-1",
			ownerUserId: "user-1",
		});

		expect(
			await responseIds(
				await songsRoutes.request("/by-playlist/owned-playlist"),
			),
		).toEqual(["owned-song"]);
		expect(
			await responseIds(await songsRoutes.request("/queue/owned-playlist")),
		).toEqual(["owned-song"]);
		expect(
			(
				await patchJson(songsRoutes, "/owned-song/status", {
					status: "played",
				})
			).status,
		).toBe(200);
		expect(
			(
				await songsRoutes.request("/owned-song/rating", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ rating: "down" }),
				})
			).status,
		).toBe(200);
		expect(
			(
				await getTestDb()
					.select({
						status: songs.status,
						userRating: songs.userRating,
						errorMessage: songs.errorMessage,
					})
					.from(songs)
					.where(eq(songs.id, "owned-song"))
			)[0],
		).toEqual({
			status: "played",
			userRating: "down",
			errorMessage: null,
		});

		for (const request of [
			patchJson(songsRoutes, "/owned-song/status", { status: "ready" }),
			patchJson(songsRoutes, "/owned-song/status", {
				status: "played",
				errorMessage: "device-injected error",
			}),
			patchJson(songsRoutes, "/owned-song/metadata", { title: "Changed" }),
			songsRoutes.request("/owned-song/claim-metadata", { method: "POST" }),
			songsRoutes.request("/owned-song/retry", { method: "POST" }),
			postJson("/create-pending", {
				playlistId: "owned-playlist",
				orderIndex: 2,
			}),
		]) {
			expect((await request).status).toBe(404);
		}
		expect(
			(
				await getTestDb()
					.select({ errorMessage: songs.errorMessage })
					.from(songs)
					.where(eq(songs.id, "owned-song"))
			)[0]?.errorMessage,
		).toBeNull();

		vi.mocked(getDeviceActor).mockResolvedValue({
			kind: "device",
			deviceId: "device-2",
			ownerUserId: "user-2",
		});
		expect((await songsRoutes.request("/queue/owned-playlist")).status).toBe(
			404,
		);
		expect(
			(
				await patchJson(songsRoutes, "/owned-song/status", {
					status: "played",
				})
			).status,
		).toBe(404);
		expect(
			(
				await songsRoutes.request("/owned-song/rating", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ rating: "up" }),
				})
			).status,
		).toBe(404);
	});

	it("allows owner-device playlist discovery and playback state only", async () => {
		vi.mocked(getDeviceActor).mockResolvedValue({
			kind: "device",
			deviceId: "device-1",
			ownerUserId: "user-1",
		});

		expect(await responseIds(await playlistsRoutes.request("/"))).toEqual([
			"owned-playlist",
			"public-playlist",
		]);
		expect((await playlistsRoutes.request("/owned-playlist")).status).toBe(200);
		expect((await playlistsRoutes.request("/by-key/owned")).status).toBe(200);
		expect((await playlistsRoutes.request("/other-playlist")).status).toBe(404);
		expect(
			(
				await playlistsRoutes.request("/owned-playlist/heartbeat", {
					method: "POST",
				})
			).status,
		).toBe(200);
		expect(
			(
				await patchJson(playlistsRoutes, "/owned-playlist/position", {
					currentOrderIndex: 1,
				})
			).status,
		).toBe(200);
		expect(
			(
				await getTestDb()
					.select({
						currentOrderIndex: playlists.currentOrderIndex,
						lastSeenAt: playlists.lastSeenAt,
					})
					.from(playlists)
					.where(eq(playlists.id, "owned-playlist"))
			)[0],
		).toEqual({
			currentOrderIndex: 1,
			lastSeenAt: expect.any(Number),
		});

		for (const request of [
			patchJson(playlistsRoutes, "/owned-playlist/prompt", {
				prompt: "Device rewrite",
			}),
			playlistsRoutes.request("/owned-playlist", { method: "DELETE" }),
			playlistsRoutes.request("/owned-playlist/agent-chat/messages", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ content: "Device chat" }),
			}),
		]) {
			expect((await request).status).toBe(404);
		}

		expect(
			(await agentMemoryRoutes.request("/?playlistId=owned-playlist")).status,
		).toBe(404);

		vi.mocked(getDeviceActor).mockResolvedValue({
			kind: "device",
			deviceId: "device-2",
			ownerUserId: "user-2",
		});
		expect((await playlistsRoutes.request("/owned-playlist")).status).toBe(404);
		expect(
			(
				await playlistsRoutes.request("/owned-playlist/heartbeat", {
					method: "POST",
				})
			).status,
		).toBe(404);
		expect(
			(
				await patchJson(playlistsRoutes, "/owned-playlist/position", {
					currentOrderIndex: 2,
				})
			).status,
		).toBe(404);
		expect(
			(
				await getTestDb()
					.select({ currentOrderIndex: playlists.currentOrderIndex })
					.from(playlists)
					.where(eq(playlists.id, "owned-playlist"))
			)[0]?.currentOrderIndex,
		).toBe(1);
	});
});
