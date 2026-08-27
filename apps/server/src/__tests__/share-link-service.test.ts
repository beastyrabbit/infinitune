import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, setupTestDb, teardownTestDb } from "./test-db";

vi.mock("../auth/actor", () => ({
	getRequestActor: vi.fn(),
}));

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
}));

import { getRequestActor } from "../auth/actor";
import { playlists, shareLinks, songs, users } from "../db/schema";
import { resetRateLimiters } from "../middleware/rate-limit";
import shareRoutes from "../routes/share";
import songsRoutes from "../routes/songs/index";
import * as shareService from "../services/share-link-service";
import * as songService from "../services/song-service";

async function seedPlaylistWithSong(): Promise<{
	playlistId: string;
	songId: string;
}> {
	const db = getTestDb();
	const now = Date.now();
	const [playlist] = await db
		.insert(playlists)
		.values({
			id: "pl-1",
			createdAt: now,
			name: "Test Playlist",
			prompt: "test prompt",
			llmProvider: "openai-codex",
			llmModel: "",
		})
		.returning();
	const [song] = await db
		.insert(songs)
		.values({
			id: "song-1",
			createdAt: now,
			playlistId: playlist.id,
			orderIndex: 1,
			title: "Test Song",
			artistName: "Tester",
			genre: "synthwave",
			status: "ready",
			audioUrl: "/audio/test.mp3",
			audioDuration: 180,
			coverUrl: "/covers/test.png",
		})
		.returning();
	return { playlistId: playlist.id, songId: song.id };
}

describe("share-link-service", () => {
	beforeEach(async () => {
		resetRateLimiters();
		setupTestDb();
		await seedPlaylistWithSong();
		vi.mocked(getRequestActor).mockResolvedValue({ kind: "anonymous" });
	});

	afterEach(() => {
		resetRateLimiters();
		teardownTestDb();
	});

	it("creates and reuses a permanent link with a url-safe token", async () => {
		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		expect(link?.token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(link?.token.length).toBeGreaterThanOrEqual(32);
		expect(link?.revokedAt).toBeNull();

		const other = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		expect(other?.token).toBe(link?.token);
		expect(await getTestDb().select().from(shareLinks)).toHaveLength(1);
	});

	it("resolves a playlist token into a public snapshot of ready songs", async () => {
		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		const resolved = await shareService.resolveShareLink(link?.token ?? "");
		expect(resolved?.resourceType).toBe("playlist");
		const payload = resolved?.payload as {
			name: string;
			songs: Array<{
				id: string;
				title: string | null;
				coverUrl: string | null;
			}>;
		};
		expect(payload.name).toBe("Test Playlist");
		expect(payload.songs).toHaveLength(1);
		expect(payload.songs[0]?.id).toBe("song-1");
		expect(payload).not.toHaveProperty("prompt");
	});

	it("resolves a song token into a single-song snapshot", async () => {
		const link = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});
		const resolved = await shareService.resolveShareLink(link?.token ?? "");
		expect(resolved?.resourceType).toBe("song");
		const payload = resolved?.payload as { song: { id: string } };
		expect(payload.song.id).toBe("song-1");
	});

	it("keeps played songs in playlist and single-song shares", async () => {
		await getTestDb()
			.update(songs)
			.set({ status: "played" })
			.where(eq(songs.id, "song-1"));

		const playlistLink = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		const playlistShare = await shareService.resolveShareLink(
			playlistLink?.token ?? "",
		);
		expect(
			(playlistShare?.payload as { songs: Array<{ id: string }> }).songs,
		).toMatchObject([{ id: "song-1" }]);

		const songLink = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});
		const songShare = await shareService.resolveShareLink(
			songLink?.token ?? "",
		);
		expect((songShare?.payload as { song: { id: string } }).song.id).toBe(
			"song-1",
		);
	});

	it("returns null for unknown tokens", async () => {
		expect(await shareService.resolveShareLink("bogus-token")).toBeNull();
	});

	it("excludes songs that are not ready", async () => {
		const db = getTestDb();
		await db
			.insert(songs)
			.values({
				id: "song-pending",
				createdAt: Date.now(),
				playlistId: "pl-1",
				orderIndex: 2,
				title: "Pending Song",
				status: "generating_audio",
			})
			.returning();

		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		const resolved = await shareService.resolveShareLink(link?.token ?? "");
		const payload = resolved?.payload as { songs: Array<{ id: string }> };
		expect(payload.songs.map((song) => song.id)).toEqual(["song-1"]);
	});

	it("does not expose ready songs without audio", async () => {
		const db = getTestDb();
		await db
			.insert(songs)
			.values({
				id: "song-no-audio",
				createdAt: Date.now(),
				playlistId: "pl-1",
				orderIndex: 2,
				title: "Silent Song",
				status: "ready",
			})
			.returning();

		const playlistLink = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		const playlistResolved = await shareService.resolveShareLink(
			playlistLink?.token ?? "",
		);
		const playlistPayload = playlistResolved?.payload as {
			songs: Array<{ id: string }>;
		};
		expect(playlistPayload.songs.map((song) => song.id)).toEqual(["song-1"]);

		const songLink = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-no-audio",
		});
		expect(
			await shareService.resolveShareLink(songLink?.token ?? ""),
		).toBeNull();
	});

	it("caps playlist snapshots in the database query", async () => {
		const db = getTestDb();
		await db.insert(songs).values(
			Array.from(
				{ length: shareService.MAX_PUBLIC_SHARE_SONGS + 5 },
				(_, index) => ({
					id: `song-${index + 2}`,
					createdAt: Date.now() + index + 1,
					playlistId: "pl-1",
					orderIndex: index + 2,
					title: `Song ${index + 2}`,
					status: "ready",
					audioUrl: `/audio/${index + 2}.mp3`,
				}),
			),
		);

		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		const resolved = await shareService.resolveShareLink(link?.token ?? "");
		const payload = resolved?.payload as { songs: Array<{ id: string }> };

		expect(payload.songs).toHaveLength(shareService.MAX_PUBLIC_SHARE_SONGS);
		expect(payload.songs[0]?.id).toBe("song-1");
		expect(payload.songs.at(-1)?.id).toBe(
			`song-${shareService.MAX_PUBLIC_SHARE_SONGS}`,
		);
	});

	it("expired links no longer resolve", async () => {
		const link = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
			expiresInDays: 1,
		});
		expect(
			await shareService.resolveShareLink(link?.token ?? ""),
		).not.toBeNull();

		const db = getTestDb();
		await db
			.update(shareLinks)
			.set({ expiresAt: Date.now() - 1000 })
			.where(eq(shareLinks.id, link?.id ?? ""));

		expect(await shareService.resolveShareLink(link?.token ?? "")).toBeNull();
	});

	it("revoked links no longer resolve and cannot be revoked twice", async () => {
		const link = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});
		expect(await shareService.revokeShareLink(link?.id ?? "")).toBe(true);
		expect(await shareService.revokeShareLink(link?.id ?? "")).toBe(false);
		expect(await shareService.resolveShareLink(link?.token ?? "")).toBeNull();
	});

	it("lists all links for a resource", async () => {
		await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
			expiresInDays: 1,
		});
		await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
			expiresInDays: 2,
		});
		const links = await shareService.listShareLinksForResource(
			"playlist",
			"pl-1",
		);
		expect(links).toHaveLength(2);
	});

	it("caps concurrent timed links per resource", async () => {
		const tokens = new Set<string>();
		const created = await Promise.all(
			Array.from(
				{ length: shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE + 10 },
				(_, index) =>
					shareService.createShareLink({
						resourceType: "playlist",
						resourceId: "pl-1",
						expiresInDays: index + 1,
					}),
			),
		);
		for (const link of created) {
			if (link) tokens.add(link.token);
		}

		expect(tokens.size).toBe(
			shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE + 10,
		);
		expect(
			(await getTestDb().select().from(shareLinks)).filter(
				(link) => link.revokedAt === null,
			),
		).toHaveLength(shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE);
	});

	it("rejects a timed-link request when the cap has no compatible link", async () => {
		await getTestDb()
			.insert(shareLinks)
			.values(
				Array.from(
					{ length: shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE },
					(_, index) => ({
						token: `permanent-${index}`,
						resourceType: "playlist",
						resourceId: "pl-1",
					}),
				),
			);

		await expect(
			shareService.createShareLink({
				resourceType: "playlist",
				resourceId: "pl-1",
				expiresInDays: 1,
			}),
		).rejects.toBeInstanceOf(shareService.ShareLinkLimitError);

		const response = await shareRoutes.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				resourceType: "playlist",
				resourceId: "pl-1",
				expiresInDays: 1,
			}),
		});
		expect(response.status).toBe(409);
	});

	it("replaces only the soonest-expiring link when timed links reach the cap", async () => {
		const created: Array<
			Awaited<ReturnType<typeof shareService.createShareLink>>
		> = [];
		for (
			let index = 0;
			index < shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE;
			index++
		) {
			created.push(
				await shareService.createShareLink({
					resourceType: "playlist",
					resourceId: "pl-1",
					expiresInDays: index + 1,
				}),
			);
		}

		const replacement = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
			expiresInDays: 30,
		});
		const rows = await getTestDb().select().from(shareLinks);
		const first = rows.find((row) => row.id === created[0]?.id);
		expect(replacement?.id).not.toBe(created[0]?.id);
		expect(first?.revokedAt).not.toBeNull();
		expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(
			shareService.MAX_LIVE_SHARE_LINKS_PER_RESOURCE,
		);
		expect(
			rows.filter((row) => row.expiresAt === null).map((row) => row.id),
		).toEqual([]);
	});

	it("permanently retains a temporary playlist shared without an expiry", async () => {
		const db = getTestDb();
		await db
			.update(playlists)
			.set({ isTemporary: true, expiresAt: Date.now() + 1000 })
			.where(eq(playlists.id, "pl-1"));

		await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});

		const [playlist] = await db
			.select()
			.from(playlists)
			.where(eq(playlists.id, "pl-1"));
		expect(playlist.isTemporary).toBe(false);
		expect(playlist.expiresAt).toBeNull();
	});

	it("does not re-temporize a promoted playlist when its permanent link is revoked", async () => {
		const db = getTestDb();
		await db
			.update(playlists)
			.set({ isTemporary: true, expiresAt: Date.now() + 1000 })
			.where(eq(playlists.id, "pl-1"));

		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		await shareService.revokeShareLink(link?.id ?? "");

		const [playlist] = await db
			.select()
			.from(playlists)
			.where(eq(playlists.id, "pl-1"));
		expect(playlist.isTemporary).toBe(false);
		expect(playlist.expiresAt).toBeNull();
	});

	it("extends temporary retention to a timed share expiry", async () => {
		const db = getTestDb();
		const originalExpiry = Date.now() + 1000;
		await db
			.update(playlists)
			.set({ isTemporary: true, expiresAt: originalExpiry })
			.where(eq(playlists.id, "pl-1"));

		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
			expiresInDays: 1,
		});

		const [playlist] = await db
			.select()
			.from(playlists)
			.where(eq(playlists.id, "pl-1"));
		expect(playlist.isTemporary).toBe(true);
		expect(playlist.expiresAt).toBe(link?.expiresAt);
		expect(playlist.expiresAt).toBeGreaterThan(originalExpiry);
	});

	it("does not add an expiry to a temporary playlist without one", async () => {
		const db = getTestDb();
		await db
			.update(playlists)
			.set({ isTemporary: true, expiresAt: null })
			.where(eq(playlists.id, "pl-1"));

		await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
			expiresInDays: 1,
		});

		const [playlist] = await db
			.select()
			.from(playlists)
			.where(eq(playlists.id, "pl-1"));
		expect(playlist.isTemporary).toBe(true);
		expect(playlist.expiresAt).toBeNull();
	});

	it("rate-limits anonymous public share resolution", async () => {
		for (let index = 0; index < 120; index++) {
			expect((await shareRoutes.request("/unknown-token")).status).toBe(404);
		}

		const limited = await shareRoutes.request("/unknown-token");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("1");
	});

	it("does not create links for missing resources", async () => {
		expect(
			await shareService.createShareLink({
				resourceType: "playlist",
				resourceId: "missing",
			}),
		).toBeNull();
		expect(await getTestDb().select().from(shareLinks)).toHaveLength(0);
	});

	it("allows anonymous link creation for an ownerless playlist", async () => {
		const response = await shareRoutes.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				resourceType: "playlist",
				resourceId: "pl-1",
			}),
		});

		expect(response.status).toBe(201);
		expect(await getTestDb().select().from(shareLinks)).toHaveLength(1);
	});

	it("hides an owned playlist from anonymous link management", async () => {
		const db = getTestDb();
		const link = await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		await db.insert(users).values({
			id: "user-1",
			createdAt: Date.now(),
			shooSubject: "shoo-user-1",
		});
		await db
			.update(playlists)
			.set({ ownerUserId: "user-1" })
			.where(eq(playlists.id, "pl-1"));

		const response = await shareRoutes.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				resourceType: "playlist",
				resourceId: "pl-1",
			}),
		});

		expect(response.status).toBe(404);

		const listResponse = await shareRoutes.request(
			"/?resourceType=playlist&resourceId=pl-1",
		);
		expect(listResponse.status).toBe(404);

		const deleteResponse = await shareRoutes.request(`/${link?.id}`, {
			method: "DELETE",
		});
		expect(deleteResponse.status).toBe(404);
		expect(
			(
				await db
					.select()
					.from(shareLinks)
					.where(eq(shareLinks.id, link?.id ?? ""))
			)[0]?.revokedAt,
		).toBeNull();
		expect(
			await shareService.resolveShareLink(link?.token ?? ""),
		).not.toBeNull();
	});

	it("allows the owner to manage links for an owned playlist", async () => {
		const db = getTestDb();
		await db.insert(users).values({
			id: "user-1",
			createdAt: Date.now(),
			shooSubject: "shoo-user-1",
		});
		await db
			.update(playlists)
			.set({ ownerUserId: "user-1" })
			.where(eq(playlists.id, "pl-1"));
		vi.mocked(getRequestActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});

		const createResponse = await shareRoutes.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				resourceType: "playlist",
				resourceId: "pl-1",
			}),
		});
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { id: string };

		const listResponse = await shareRoutes.request(
			"/?resourceType=playlist&resourceId=pl-1",
		);
		expect(listResponse.status).toBe(200);
		expect((await listResponse.json()) as { links: unknown[] }).toMatchObject({
			links: [{ id: created.id }],
		});

		const deleteResponse = await shareRoutes.request(`/${created.id}`, {
			method: "DELETE",
		});
		expect(deleteResponse.status).toBe(200);
	});

	it("applies playlist ownership when sharing a song", async () => {
		const db = getTestDb();
		await db.insert(users).values({
			id: "user-1",
			createdAt: Date.now(),
			shooSubject: "shoo-user-1",
		});
		await db
			.update(playlists)
			.set({ ownerUserId: "user-1" })
			.where(eq(playlists.id, "pl-1"));

		const response = await shareRoutes.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ resourceType: "song", resourceId: "song-1" }),
		});

		expect(response.status).toBe(404);
	});

	it("does not turn a shared owned song id into a mutation capability", async () => {
		const db = getTestDb();
		await db.insert(users).values({
			id: "user-1",
			createdAt: Date.now(),
			shooSubject: "shoo-user-1",
		});
		await db
			.update(playlists)
			.set({ ownerUserId: "user-1" })
			.where(eq(playlists.id, "pl-1"));
		const link = await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});
		expect(
			await shareService.resolveShareLink(link?.token ?? ""),
		).not.toBeNull();

		expect((await songsRoutes.request("/song-1")).status).toBe(404);
		expect(
			(
				await songsRoutes.request("/song-1/revert", {
					method: "POST",
				})
			).status,
		).toBe(404);
		expect(
			(
				await songsRoutes.request("/song-1", {
					method: "DELETE",
				})
			).status,
		).toBe(404);
		expect(await songService.getById("song-1")).not.toBeNull();

		vi.mocked(getRequestActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		expect((await songsRoutes.request("/song-1")).status).toBe(200);
	});

	it("cleans up playlist and song links when their resources are deleted", async () => {
		const db = getTestDb();
		await shareService.createShareLink({
			resourceType: "playlist",
			resourceId: "pl-1",
		});
		await shareService.createShareLink({
			resourceType: "song",
			resourceId: "song-1",
		});

		await db.delete(playlists).where(eq(playlists.id, "pl-1"));

		expect(await db.select().from(shareLinks)).toHaveLength(0);
	});
});
