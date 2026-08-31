import { eq } from "drizzle-orm";
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

// These tests exercise the deterministic fallback path of createRadioAlbum;
// the LLM planner (and mixer) must never make real network calls here.
vi.mock("../external/llm-client", () => ({
	callLlmObject: vi.fn().mockRejectedValue(new Error("llm disabled in test")),
	callLlmText: vi.fn().mockRejectedValue(new Error("llm disabled in test")),
}));

import { albums, playlists, songs } from "../db/schema";
import {
	createRadioAlbum,
	getInventoryStats,
	markAlbumFirstPlayed,
	topUpInventory,
} from "../services/album-generation-service";
import { recomputeRadioSchedule } from "../services/radio-mixer-service";
import {
	activateListener,
	deactivateListener,
	ensureRadioStation,
	flushInventoryTopUpForTests,
	getStationSnapshot,
	seekStation,
	stopRadioRuntimeForTests,
} from "../services/radio-station-service";
import * as songService from "../services/song-service";

async function createPlaylist() {
	const [playlist] = await getTestDb()
		.insert(playlists)
		.values({
			name: "Test",
			prompt: "test",
			llmProvider: "openai-codex",
			llmModel: "gpt-5.2",
			mode: "radio",
			status: "active",
			songsGenerated: 0,
			promptEpoch: 0,
		})
		.returning();
	return playlist;
}

async function createReadyRadioSong() {
	const playlist = await createPlaylist();
	const [album] = await getTestDb()
		.insert(albums)
		.values({
			title: "Ready Album",
			theme: "test",
			status: "ready",
			generationKind: "default",
		})
		.returning();
	const [song] = await getTestDb()
		.insert(songs)
		.values({
			playlistId: playlist.id,
			orderIndex: 1,
			title: "Ready Radio",
			artistName: "Infinitune",
			status: "ready",
			audioUrl: "/api/songs/test/audio",
			audioDuration: 180,
			albumId: album.id,
			albumTrackNumber: 1,
			radioEligible: true,
		})
		.returning();
	return { album, song };
}

describe("global radio services", () => {
	beforeEach(() => {
		setupTestDb();
		ensureRadioStation();
	});

	afterEach(async () => {
		// activateListener now kicks off inventory top-up in the background;
		// let it settle before closing the DB so it doesn't race teardown.
		await flushInventoryTopUpForTests();
		stopRadioRuntimeForTests();
		teardownTestDb();
	});

	it("creates 12-track radio albums with one cover prompt and 180-second tracks", async () => {
		const album = await createRadioAlbum({
			kind: "manual",
			prompt: "glass city pop",
		});
		const rows = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));

		expect(rows).toHaveLength(12);
		expect(rows.filter((row) => row.coverPrompt)).toHaveLength(1);
		expect(rows.every((row) => row.audioDuration === 180)).toBe(true);
		expect(rows.every((row) => row.radioEligible)).toBe(true);
		expect(album.bandName).toBeTruthy();
		expect(rows.every((row) => row.artistName === album.bandName)).toBe(true);
		const coverTrack = rows.find((row) => row.albumTrackNumber === 1);
		expect(coverTrack?.coverPrompt).toContain(album.title);
		expect(coverTrack?.coverPrompt).toContain(album.bandName);
		expect(rows.map((row) => row.albumTrackNumber)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
		expect(rows.map((row) => row.orderIndex)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("does not top up without active listeners and stops at 10 untouched active albums", async () => {
		expect((await topUpInventory()).created).toBe(0);

		getTestSqlite()
			.prepare(
				"UPDATE radio_stations SET active_listener_count = 1 WHERE id = 'global'",
			)
			.run();
		const first = await topUpInventory();
		const second = await topUpInventory();

		expect(first.created).toBe(10);
		expect(second.created).toBe(0);
		expect(getInventoryStats().untouchedActiveAlbums).toBe(10);
	});

	it("repairs incomplete untouched album rows before counting inventory full", async () => {
		const album = await createRadioAlbum({ kind: "default" });
		getTestSqlite()
			.prepare(
				"DELETE FROM songs WHERE album_id = ? AND album_track_number > 1",
			)
			.run(album.id);
		getTestSqlite()
			.prepare(
				"UPDATE radio_stations SET active_listener_count = 1, inventory_target = 1 WHERE id = 'global'",
			)
			.run();

		expect(getInventoryStats().incompleteAlbums).toBe(1);
		expect(getInventoryStats().missingAlbumTracks).toBe(11);

		const result = await topUpInventory();
		const rows = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));

		expect(result.created).toBe(0);
		expect(result.repairedTracks).toBe(11);
		expect(rows).toHaveLength(12);
		expect(getInventoryStats().missingAlbumTracks).toBe(0);
		expect(getInventoryStats().untouchedGeneratingAlbums).toBe(1);
	});

	it("manual force creates at most one album beyond the inventory target", async () => {
		getTestSqlite()
			.prepare(
				"UPDATE radio_stations SET active_listener_count = 1 WHERE id = 'global'",
			)
			.run();
		await topUpInventory();

		const firstManual = await topUpInventory({ force: true });
		const secondManual = await topUpInventory({ force: true });

		expect(firstManual.created).toBe(1);
		expect(secondManual.created).toBe(0);
		expect(secondManual.skipped).toBe("manual-extra-already-queued");
		expect(getInventoryStats().untouchedActiveAlbums).toBe(11);
	});

	it("removes an album from untouched inventory as soon as first playback is marked", async () => {
		const album = await createRadioAlbum({ kind: "manual" });
		getTestSqlite()
			.prepare("UPDATE albums SET status = 'ready' WHERE id = ?")
			.run(album.id);
		getTestSqlite()
			.prepare("UPDATE songs SET status = 'ready' WHERE album_id = ?")
			.run(album.id);
		expect(getInventoryStats().untouchedReadyAlbums).toBe(1);

		await markAlbumFirstPlayed(album.id, Date.now());

		expect(getInventoryStats().untouchedReadyAlbums).toBe(0);
	});

	it("increments radio feedback counters without toggling", async () => {
		const { song } = await createReadyRadioSong();

		await songService.incrementRadioFeedback(song.id, "like");
		await songService.incrementRadioFeedback(song.id, "like");
		await songService.incrementRadioFeedback(song.id, "dislike");

		const row = await songService.getById(song.id);
		expect(row?.likeCount).toBe(2);
		expect(row?.dislikeCount).toBe(1);
	});

	it("rejects feedback for unknown and non-radio songs", async () => {
		const playlist = await createPlaylist();
		const [legacySong] = await getTestDb()
			.insert(songs)
			.values({
				playlistId: playlist.id,
				orderIndex: 1,
				title: "Legacy",
				status: "ready",
				radioEligible: false,
			})
			.returning();

		await expect(
			songService.incrementRadioFeedback("missing-song", "like"),
		).resolves.toBe(false);
		await expect(
			songService.incrementRadioFeedback(legacySong.id, "like"),
		).resolves.toBe(false);
		expect((await songService.getById(legacySong.id))?.likeCount).toBe(0);
	});

	it("mixes only ready songs from radio albums and excludes legacy songs", async () => {
		const { song } = await createReadyRadioSong();
		const playlist = await createPlaylist();
		await getTestDb().insert(songs).values({
			playlistId: playlist.id,
			orderIndex: 99,
			title: "Legacy Ready",
			status: "ready",
			audioDuration: 180,
			radioEligible: false,
		});

		const schedule = recomputeRadioSchedule("test");

		expect(schedule.map((item) => item.songId)).toEqual([song.id]);
	});

	it("applies the library limit after excluding radio album tracks", async () => {
		const playlist = await createPlaylist();
		await getTestDb().insert(albums).values({
			id: "album-1",
			title: "Newest album",
			theme: "test",
			status: "ready",
			generationKind: "default",
		});
		await getTestDb()
			.insert(songs)
			.values([
				{
					playlistId: playlist.id,
					orderIndex: 1,
					createdAt: 1,
					title: "Older legacy",
					status: "ready",
					radioEligible: false,
				},
				{
					playlistId: playlist.id,
					orderIndex: 2,
					createdAt: 2,
					title: "Newer legacy",
					status: "ready",
					radioEligible: false,
				},
				{
					playlistId: playlist.id,
					orderIndex: 3,
					createdAt: 3,
					title: "Newest album track",
					status: "ready",
					albumId: "album-1",
					radioEligible: true,
				},
			]);

		const legacySongs = await songService.listLegacy(2, { ownerUserId: null });

		expect(legacySongs.map((song) => song.title)).toEqual([
			"Newer legacy",
			"Older legacy",
		]);
	});

	it("spaces album runs in the fallback radio schedule", async () => {
		const playlist = await createPlaylist();
		const makeAlbum = async (title: string, startOrder: number) => {
			const [album] = await getTestDb()
				.insert(albums)
				.values({
					title,
					bandName: `${title} Band`,
					theme: title,
					status: "ready",
					generationKind: "default",
				})
				.returning();
			for (let i = 1; i <= 4; i++) {
				await getTestDb()
					.insert(songs)
					.values({
						playlistId: playlist.id,
						orderIndex: startOrder + i,
						title: `${title} ${i}`,
						artistName: `${title} Band`,
						status: "ready",
						audioUrl: `/api/songs/${title}-${i}/audio`,
						audioDuration: 180,
						albumId: album.id,
						albumTrackNumber: i,
						radioEligible: true,
						genre: i % 2 === 0 ? "future funk" : "dream pop",
						vocalStyle: i % 2 === 0 ? "male lead" : "female lead",
					});
			}
			return album;
		};
		await makeAlbum("Glass Arcade", 0);
		await makeAlbum("Silver Rooftop", 10);

		const schedule = recomputeRadioSchedule("test");
		const albumIds = schedule.map((item) => item.albumId);

		for (let i = 1; i < albumIds.length; i++) {
			expect(albumIds[i]).not.toBe(albumIds[i - 1]);
		}
	});

	it("pauses when the last listener leaves and resumes from the stored offset", async () => {
		await createReadyRadioSong();
		getTestSqlite()
			.prepare(
				"UPDATE radio_stations SET inventory_target = 0 WHERE id = 'global'",
			)
			.run();
		recomputeRadioSchedule("test");

		await activateListener("listener-a");
		seekStation(42);
		const paused = deactivateListener("listener-a");
		expect(paused.station.isPlaying).toBe(false);
		expect(paused.station.offsetMs).toBeGreaterThanOrEqual(41_900);

		const resumed = await activateListener("listener-b");
		expect(resumed.station.isPlaying).toBe(true);
		expect(getStationSnapshot().station.offsetMs).toBeGreaterThanOrEqual(
			41_900,
		);
	});
});
