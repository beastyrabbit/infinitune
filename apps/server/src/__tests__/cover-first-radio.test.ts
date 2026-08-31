import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const { callLlmObjectMock } = vi.hoisted(() => ({
	callLlmObjectMock: vi.fn(),
}));

vi.mock("../external/llm-client", () => ({
	callLlmObject: callLlmObjectMock,
	callLlmText: vi.fn(),
}));

// Import after mocks are set up
import { albums, radioStationPresets, songs } from "../db/schema";
import { emit } from "../events/event-bus";
import {
	buildYtSearchTarget,
	downloadYoutubeAudio,
} from "../external/youtube-audio";
import {
	createRadioAlbum,
	listRadioAlbums,
	markAlbumReadyIfComplete,
	RADIO_LIBRARY_ALBUM_LIMIT,
	RADIO_LIBRARY_TRACK_LIMIT,
} from "../services/album-generation-service";
import {
	type AlbumPlan,
	buildTrackTypeMix,
	normalizeAlbumPlanTracks,
} from "../services/album-planner";
import {
	addCoverSource,
	chooseAcquisitionMethod,
	claimSeededSource,
	DEFAULT_RADIO_SOURCE_SETTINGS,
	deleteCoverSource,
	listCoverSources,
	markSourceFailed,
	markSourceUsed,
	parseRadioSourceSettings,
	pickCoverOfCoverSource,
	resolveCoverSourceSpec,
} from "../services/cover-source-service";
import * as songService from "../services/song-service";

describe("parseRadioSourceSettings", () => {
	it("returns defaults for an empty settings map", () => {
		expect(parseRadioSourceSettings({})).toEqual(DEFAULT_RADIO_SOURCE_SETTINGS);
	});

	it("parses configured values", () => {
		const parsed = parseRadioSourceSettings({
			radioCoversPerAlbum: "6",
			radioNewPerAlbum: "2",
			radioCoverOfCoverPerAlbum: "0",
			radioRandomFill: "4",
			radioSearchRatio: "0.5",
			radioSourceLibraryDir: " /mnt/nas/music ",
			radioCoverNoiseStrength: "0.7",
		});
		expect(parsed).toEqual({
			coversPerAlbum: 6,
			newPerAlbum: 2,
			coverOfCoverPerAlbum: 0,
			randomFill: 4,
			searchRatio: 0.5,
			sourceLibraryDir: "/mnt/nas/music",
			coverNoiseStrength: 0.7,
		});
	});

	it("falls back on invalid values", () => {
		const parsed = parseRadioSourceSettings({
			radioCoversPerAlbum: "-3",
			radioSearchRatio: "1.7",
			radioCoverNoiseStrength: "nope",
		});
		expect(parsed.coversPerAlbum).toBe(8);
		expect(parsed.searchRatio).toBe(0.75);
		expect(parsed.coverNoiseStrength).toBe(0.5);
	});

	it("clamps absurdly large counts to the album size bound", () => {
		const parsed = parseRadioSourceSettings({
			radioCoversPerAlbum: "100000",
			radioRandomFill: "5000",
		});
		expect(parsed.coversPerAlbum).toBe(12);
		expect(parsed.randomFill).toBe(12);
	});
});

describe("buildTrackTypeMix", () => {
	it("produces the configured composition for the default mix", () => {
		// rand=0 → random fill always picks "cover" (the assertions only
		// count types, so the rand=0 shuffle rotation doesn't matter)
		const mix = buildTrackTypeMix(DEFAULT_RADIO_SOURCE_SETTINGS, 12, () => 0);
		expect(mix).toHaveLength(12);
		expect(mix.filter((t) => t === "cover")).toHaveLength(10); // 8 + 2 fill
		expect(mix.filter((t) => t === "new")).toHaveLength(1);
		expect(mix.filter((t) => t === "cover-of-cover")).toHaveLength(1);
	});

	it("pads with covers when the mix under-fills the album", () => {
		const mix = buildTrackTypeMix(
			{ ...DEFAULT_RADIO_SOURCE_SETTINGS, coversPerAlbum: 1, randomFill: 0 },
			12,
			() => 0,
		);
		expect(mix).toHaveLength(12);
		expect(mix.filter((t) => t === "cover")).toHaveLength(10);
	});

	it("truncates when the mix over-fills the album", () => {
		const mix = buildTrackTypeMix(
			{ ...DEFAULT_RADIO_SOURCE_SETTINGS, coversPerAlbum: 20 },
			12,
			() => 0,
		);
		expect(mix).toHaveLength(12);
	});

	it("shuffles deterministically with an injected rand", () => {
		const a = buildTrackTypeMix(DEFAULT_RADIO_SOURCE_SETTINGS, 12, () => 0.4);
		const b = buildTrackTypeMix(DEFAULT_RADIO_SOURCE_SETTINGS, 12, () => 0.4);
		expect(a).toEqual(b);
	});
});

describe("normalizeAlbumPlanTracks", () => {
	const baseTrack = {
		title: "Track",
		lyrics: "[Verse]\nhello",
		caption: "synthwave cover",
		vocalStyle: "female lead",
	};

	it("forces slot types back to the requested plan and fills gaps", () => {
		const plan: AlbumPlan = {
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: [
				{
					...baseTrack,
					trackNumber: 1,
					type: "new", // wrong — slot 1 is a cover
					searchTarget: { title: "Take On Me", artist: "a-ha" },
				},
				{
					...baseTrack,
					trackNumber: 2,
					type: "cover",
					searchTarget: { title: "Billie Jean", artist: "Michael Jackson" },
				},
			],
		};
		const normalized = normalizeAlbumPlanTracks(plan, [
			"cover",
			"new",
			"cover",
		]);
		expect(normalized).toHaveLength(3);
		expect(normalized[0]?.type).toBe("cover");
		expect(normalized[0]?.searchTarget?.title).toBe("Take On Me");
		expect(normalized[0]?.variation).toBe("both");
		// slot 2 forced to "new": search target dropped
		expect(normalized[1]?.type).toBe("new");
		expect(normalized[1]?.searchTarget).toBeNull();
		// slot 3 missing from the LLM output
		expect(normalized[2]).toBeUndefined();
	});

	it("dedupes duplicate track numbers (first wins) and ignores out-of-range ones", () => {
		const plan: AlbumPlan = {
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: [
				{ ...baseTrack, trackNumber: 1, type: "cover", title: "First" },
				{ ...baseTrack, trackNumber: 1, type: "cover", title: "Duplicate" },
				{ ...baseTrack, trackNumber: 9, type: "cover", title: "Out of range" },
			],
		};
		const normalized = normalizeAlbumPlanTracks(plan, ["cover", "new"]);
		expect(normalized).toHaveLength(2);
		expect(normalized[0]?.title).toBe("First");
		expect(normalized[1]).toBeUndefined();
	});

	it("preserves an explicit cover variation", () => {
		const plan: AlbumPlan = {
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: [
				{
					...baseTrack,
					trackNumber: 1,
					type: "cover",
					variation: "genre",
					searchTarget: { title: "Take On Me", artist: "a-ha" },
				},
			],
		};
		const normalized = normalizeAlbumPlanTracks(plan, ["cover"]);
		expect(normalized[0]?.variation).toBe("genre");
	});
});

describe("buildYtSearchTarget", () => {
	it("builds a ytsearch1 target from title + artist", () => {
		expect(
			buildYtSearchTarget("Billie Jean Michael Jackson official audio"),
		).toBe("ytsearch1:Billie Jean Michael Jackson official audio");
	});

	it("strips control chars and collapses whitespace", () => {
		expect(buildYtSearchTarget("a\u0001b\n  c\t d")).toBe("ytsearch1:a b c d");
	});

	it("caps query length", () => {
		const target = buildYtSearchTarget("x".repeat(500));
		expect(target.length).toBeLessThanOrEqual("ytsearch1:".length + 200);
	});

	it("rejects empty queries", () => {
		expect(() => buildYtSearchTarget("    ")).toThrow("Empty search query");
	});
});

describe("downloadYoutubeAudio SSRF guard", () => {
	it("rejects non-http protocols", async () => {
		await expect(downloadYoutubeAudio("ftp://example.com/x")).rejects.toThrow(
			"Only http(s) URLs are supported",
		);
	});

	it("rejects invalid URLs", async () => {
		await expect(downloadYoutubeAudio("not a url")).rejects.toThrow(
			"Invalid URL",
		);
	});

	it("rejects hosts resolving to private ranges", async () => {
		await expect(
			downloadYoutubeAudio("http://localhost:8080/internal"),
		).rejects.toThrow("URL host is not allowed");
	});
});

describe("chooseAcquisitionMethod", () => {
	it("routes by the configured ratio", () => {
		expect(chooseAcquisitionMethod(0.5, 0.75)).toBe("search");
		expect(chooseAcquisitionMethod(0.8, 0.75)).toBe("nas");
		expect(chooseAcquisitionMethod(0.1, 0)).toBe("nas");
		expect(chooseAcquisitionMethod(0.99, 1)).toBe("search");
	});
});

describe("cover_sources pool", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it("adds, lists, and deletes sources", async () => {
		const row = await addCoverSource("https://youtube.com/watch?v=abc", "");
		expect(row.status).toBe("pending");
		expect(row.genreTag).toBeNull();
		expect(await listCoverSources()).toHaveLength(1);
		expect(await deleteCoverSource(row.id)).toBe(true);
		expect(await listCoverSources()).toHaveLength(0);
	});

	it("claims oldest pending source and marks it used", async () => {
		const first = await addCoverSource("https://youtube.com/watch?v=1");
		await addCoverSource("https://youtube.com/watch?v=2");
		const claimed = await claimSeededSource("synthwave");
		expect(claimed?.id).toBe(first.id);
		const sources = await listCoverSources();
		expect(sources.find((s) => s.id === first.id)?.status).toBe("used");
	});

	it("honors genre tags when claiming", async () => {
		await addCoverSource("https://youtube.com/watch?v=jazz", "jazz");
		expect(await claimSeededSource("synthwave")).toBeNull();
		const claimed = await claimSeededSource("Jazz Fusion Nights");
		expect(claimed?.url).toContain("jazz");
	});

	it("marks sources failed by url", async () => {
		const row = await addCoverSource("https://youtube.com/watch?v=bad");
		await markSourceFailed(row.url);
		const sources = await listCoverSources();
		expect(sources[0].status).toBe("failed");
	});

	it("prefers the seeded pool in source resolution", async () => {
		await addCoverSource("https://youtube.com/watch?v=seeded");
		const spec = await resolveCoverSourceSpec({
			albumGenre: "synthwave",
			searchTarget: "ytsearch1:something else",
			settings: DEFAULT_RADIO_SOURCE_SETTINGS,
		});
		expect(spec).toEqual({
			kind: "seeded",
			sourceUrl: "https://youtube.com/watch?v=seeded",
		});
	});

	it("falls back to search when pool and NAS are empty", async () => {
		const spec = await resolveCoverSourceSpec({
			albumGenre: "synthwave",
			searchTarget: "ytsearch1:billie jean official audio",
			settings: { ...DEFAULT_RADIO_SOURCE_SETTINGS, searchRatio: 0 },
		});
		expect(spec).toEqual({
			kind: "search",
			sourceUrl: "ytsearch1:billie jean official audio",
		});
	});

	it("resolves to none when nothing is available", async () => {
		const spec = await resolveCoverSourceSpec({
			albumGenre: "synthwave",
			searchTarget: null,
			settings: DEFAULT_RADIO_SOURCE_SETTINGS,
		});
		expect(spec).toEqual({ kind: "none" });
	});
});

function insertTestPlaylist(id = "p1") {
	getTestSqlite()
		.prepare(
			"INSERT INTO playlists (id, created_at, name, prompt, llm_provider, llm_model) VALUES (?, 0, 'n', 'p', 'openai-codex', '')",
		)
		.run(id);
}

describe("pickCoverOfCoverSource", () => {
	let storageDir: string;

	beforeEach(() => {
		setupTestDb();
		storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "infinitune-cov-"));
		fs.writeFileSync(path.join(storageDir, "audio.mp3"), "x");
	});
	afterEach(() => {
		teardownTestDb();
		fs.rmSync(storageDir, { recursive: true, force: true });
	});

	it("returns a ready cover with reachable audio, ignoring non-covers", async () => {
		const db = getTestDb();
		insertTestPlaylist();
		// Ready non-cover with reachable audio must NOT qualify
		await db.insert(songs).values({
			playlistId: "p1",
			orderIndex: 1,
			status: "ready",
			radioEligible: true,
			storagePath: storageDir,
		});
		const [cover] = await db
			.insert(songs)
			.values({
				playlistId: "p1",
				orderIndex: 2,
				status: "ready",
				radioEligible: true,
				aceTaskType: "cover",
				storagePath: storageDir,
			})
			.returning({ id: songs.id });
		expect(await pickCoverOfCoverSource()).toBe(cover.id);
	});

	it("returns null when covers exist but their audio is unreachable", async () => {
		const db = getTestDb();
		insertTestPlaylist();
		await db.insert(songs).values({
			playlistId: "p1",
			orderIndex: 1,
			status: "ready",
			radioEligible: true,
			aceTaskType: "cover",
			storagePath: "/nonexistent/path",
		});
		expect(await pickCoverOfCoverSource()).toBeNull();
	});

	it("returns null when no ready covers exist", async () => {
		insertTestPlaylist();
		expect(await pickCoverOfCoverSource()).toBeNull();
	});
});

describe("song-service cover source persistence", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	async function insertCoverSong() {
		insertTestPlaylist();
		const [row] = await getTestDb()
			.insert(songs)
			.values({
				playlistId: "p1",
				orderIndex: 1,
				status: "metadata_ready",
				radioEligible: true,
				aceTaskType: "cover",
				sourceUrl: "ytsearch1:billie jean official audio",
				sourceSongId: "other-song",
				sourceAudioPath: "/tmp/ref.mp3",
				coverNoiseStrength: 0.5,
			})
			.returning({ id: songs.id });
		return row.id;
	}

	it("clearCoverSource nulls every cover field (demotion to text2music)", async () => {
		const id = await insertCoverSong();
		await songService.clearCoverSource(id);
		const [row] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, id));
		expect(row.aceTaskType).toBeNull();
		expect(row.sourceUrl).toBeNull();
		expect(row.sourceSongId).toBeNull();
		expect(row.sourceAudioPath).toBeNull();
		expect(row.coverNoiseStrength).toBeNull();
	});

	it("updateSourceAudioPath persists the resolved reference file", async () => {
		const id = await insertCoverSong();
		await songService.updateSourceAudioPath(id, "/tmp/resolved.mp3");
		const [row] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, id));
		expect(row.sourceAudioPath).toBe("/tmp/resolved.mp3");
	});

	it("markSourceUsed records the resolved path on the pool row by url", async () => {
		const seeded = await addCoverSource("https://youtube.com/watch?v=u1");
		await markSourceUsed(seeded.url, "/tmp/resolved.mp3");
		const sources = await listCoverSources();
		expect(sources[0].resolvedAudioPath).toBe("/tmp/resolved.mp3");
	});
});

function makePlanTrack(trackNumber: number, withSearchTarget: boolean) {
	return {
		trackNumber,
		type: "cover" as const,
		title: `Track ${trackNumber}`,
		searchTarget: withSearchTarget
			? { title: `Song ${trackNumber}`, artist: "Artist" }
			: null,
		variation: "both" as const,
		lyrics: "[Verse]\nhello",
		caption: "cover in album style",
		vocalStyle: "female lead",
	};
}

describe("createRadioAlbum", () => {
	beforeEach(() => {
		setupTestDb();
		callLlmObjectMock.mockReset();
	});
	afterEach(() => teardownTestDb());

	it("falls back to a deterministic 12-track album when the planner fails", async () => {
		callLlmObjectMock.mockRejectedValue(new Error("planner down"));
		const album = await createRadioAlbum({ kind: "manual" });
		const tracks = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));
		expect(tracks).toHaveLength(12);
		expect(
			tracks.every((t) => !t.aceTaskType && !t.sourceUrl && !t.sourceAudioPath),
		).toBe(true);
		expect(tracks.every((t) => t.status === "metadata_ready")).toBe(true);
	});

	it("wires planned cover slots to ACE cover tasks with search sources", async () => {
		callLlmObjectMock.mockResolvedValue({
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: Array.from({ length: 12 }, (_, i) => makePlanTrack(i + 1, true)),
		});
		const album = await createRadioAlbum({ kind: "manual" });
		expect(album.title).toBe("Night Circuit");
		expect(album.bandName).toBe("Chrome Mirage");

		const tracks = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));
		expect(tracks).toHaveLength(12);
		const covers = tracks.filter((t) => t.aceTaskType === "cover");
		// Default mix: 8 covers + 1 cover-of-cover (falls back to a search
		// cover — no covers exist yet) + 2 random fills; at least 9 covers.
		expect(covers.length).toBeGreaterThanOrEqual(9);
		for (const cover of covers) {
			expect(cover.sourceUrl).toMatch(/^ytsearch1:/);
			expect(cover.coverNoiseStrength).toBe(0.5);
			expect(cover.genre).toBe("synthwave");
		}
		// The "new" slot(s) carry no source spec
		expect(tracks.some((t) => !t.aceTaskType)).toBe(true);
	});

	it("passes the complete active station intent to the album planner", async () => {
		const genrePrompt =
			"Slow-burning analog synthwave with evolving modular sequences, cavernous drums, dub delays, and a patient neon-noir atmosphere that keeps building.";
		const vocalStyle =
			"Low contralto lead with intimate verses and wide, layered harmonies in each chorus";
		await getTestDb().insert(radioStationPresets).values({
			name: "Midnight Signal",
			genrePrompt,
			vocalStyle,
			isActive: true,
		});
		callLlmObjectMock.mockResolvedValue({
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: Array.from({ length: 12 }, (_, i) => makePlanTrack(i + 1, true)),
		});

		await createRadioAlbum({ kind: "manual" });

		const plannerCall = callLlmObjectMock.mock.calls[0]?.[0] as
			| { prompt?: string }
			| undefined;
		expect(plannerCall?.prompt).toContain(genrePrompt);
		expect(plannerCall?.prompt).toContain(vocalStyle);
	});

	it("keeps station intent when a listener request seeds the album", async () => {
		const genrePrompt = "Dub techno with patient chords and deep sub bass";
		const vocalStyle = "Soft spoken-word phrases with distant harmonies";
		await getTestDb().insert(radioStationPresets).values({
			name: "Deep Current",
			genrePrompt,
			vocalStyle,
			isActive: true,
		});
		callLlmObjectMock.mockResolvedValue({
			album: {
				targetGenre: "dub techno",
				era: "2000s",
				vibe: "submerged",
				bandName: "Deep Current",
				albumTitle: "Pressure Lines",
			},
			tracks: Array.from({ length: 12 }, (_, i) => makePlanTrack(i + 1, true)),
		});

		await createRadioAlbum({
			kind: "request",
			prompt: "A hopeful song about coming home",
			targetTrackPrompt: "A hopeful song about coming home",
		});

		const plannerCall = callLlmObjectMock.mock.calls[0]?.[0] as
			| { prompt?: string }
			| undefined;
		expect(plannerCall?.prompt).toContain(genrePrompt);
		expect(plannerCall?.prompt).toContain(vocalStyle);
		expect(plannerCall?.prompt).toContain("A hopeful song about coming home");
	});

	it("keeps the active station intent when the planner falls back", async () => {
		const genrePrompt =
			"Dusty trip-hop drums, bowed bass, detuned tape loops, and spacious nocturnal production";
		const vocalStyle = "Close-miked smoky alto with restrained harmonies";
		await getTestDb().insert(radioStationPresets).values({
			name: "After Hours",
			genrePrompt,
			vocalStyle,
			isActive: true,
		});
		callLlmObjectMock.mockRejectedValue(new Error("planner down"));

		const album = await createRadioAlbum({ kind: "manual" });
		const tracks = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));

		expect(tracks).toHaveLength(12);
		expect(tracks.every((track) => track.vocalStyle === vocalStyle)).toBe(true);
		expect(tracks.every((track) => track.caption?.includes(genrePrompt))).toBe(
			true,
		);
	});

	it("demotes cover slots to plain tracks when no source is acquirable", async () => {
		callLlmObjectMock.mockResolvedValue({
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			// No searchTarget anywhere; pool empty, NAS unset → kind "none"
			tracks: Array.from({ length: 12 }, (_, i) => makePlanTrack(i + 1, false)),
		});
		const album = await createRadioAlbum({ kind: "manual" });
		const tracks = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));
		expect(tracks).toHaveLength(12);
		expect(
			tracks.every((t) => !t.aceTaskType && !t.sourceUrl && !t.sourceAudioPath),
		).toBe(true);
	});

	it("claims a seeded source for a planned cover", async () => {
		await addCoverSource("https://youtube.com/watch?v=seeded", "synthwave");
		callLlmObjectMock.mockResolvedValue({
			album: {
				targetGenre: "synthwave",
				era: "1980s",
				vibe: "neon night drive",
				bandName: "Chrome Mirage",
				albumTitle: "Night Circuit",
			},
			tracks: Array.from({ length: 12 }, (_, i) => makePlanTrack(i + 1, true)),
		});
		const album = await createRadioAlbum({ kind: "manual" });
		const tracks = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.albumId, album.id));
		expect(
			tracks.filter(
				(t) => t.sourceUrl === "https://youtube.com/watch?v=seeded",
			),
		).toHaveLength(1);
		const sources = await listCoverSources();
		expect(sources[0].status).toBe("used");
	});
});

describe("markAlbumReadyIfComplete", () => {
	beforeEach(() => {
		setupTestDb();
		vi.mocked(emit).mockClear();
	});
	afterEach(() => teardownTestDb());

	function albumReadyEmitCount(): number {
		return vi
			.mocked(emit)
			.mock.calls.filter(([event]) => event === "radio.album_ready").length;
	}

	async function insertReadyAlbum(allReady = true) {
		const db = getTestDb();
		insertTestPlaylist();
		const [album] = await db
			.insert(albums)
			.values({ title: "A", theme: "t", status: "generating" })
			.returning({ id: albums.id });
		for (let i = 1; i <= 12; i++) {
			await db.insert(songs).values({
				playlistId: "p1",
				orderIndex: i,
				status: allReady || i < 12 ? "ready" : "generating_audio",
				radioEligible: true,
				albumId: album.id,
				albumTrackNumber: i,
			});
		}
		return album.id;
	}

	it("emits radio.album_ready exactly once across repeated calls (loop guard)", async () => {
		const albumId = await insertReadyAlbum(true);
		await markAlbumReadyIfComplete(albumId);
		await markAlbumReadyIfComplete(albumId);
		// A second emit would re-trigger topUpInventory → re-enter here forever.
		expect(albumReadyEmitCount()).toBe(1);
	});

	it("does not emit or mark ready when a track is not ready", async () => {
		const albumId = await insertReadyAlbum(false);
		await markAlbumReadyIfComplete(albumId);
		expect(albumReadyEmitCount()).toBe(0);
		const [row] = await getTestDb()
			.select({ status: albums.status })
			.from(albums)
			.where(eq(albums.id, albumId));
		expect(row.status).toBe("generating");
	});
});

describe("listRadioAlbums", () => {
	beforeEach(() => {
		setupTestDb();
		insertTestPlaylist();
	});
	afterEach(() => teardownTestDb());

	it("bounds both album rows and their radio-track rows", async () => {
		const sqlite = getTestSqlite();
		const insertAlbum = sqlite.prepare(
			"INSERT INTO albums (id, created_at, title, theme) VALUES (?, ?, ?, 'test')",
		);
		const insertTrack = sqlite.prepare(
			`INSERT INTO songs (
				id, created_at, playlist_id, order_index, status,
				album_id, album_track_number, radio_eligible
			) VALUES (?, ?, 'p1', ?, 'ready', ?, ?, 1)`,
		);
		sqlite.transaction(() => {
			for (
				let albumIndex = 0;
				albumIndex <= RADIO_LIBRARY_ALBUM_LIMIT;
				albumIndex++
			) {
				const albumId = `album-${albumIndex}`;
				insertAlbum.run(albumId, albumIndex, `Album ${albumIndex}`);
				for (let trackNumber = 1; trackNumber <= 13; trackNumber++) {
					insertTrack.run(
						`${albumId}-track-${trackNumber}`,
						albumIndex * 100 + trackNumber,
						trackNumber,
						albumId,
						trackNumber,
					);
				}
			}
		})();

		const result = await listRadioAlbums();
		expect(result).toHaveLength(RADIO_LIBRARY_ALBUM_LIMIT);
		expect(result.map((album) => album.id)).not.toContain("album-0");
		expect(result.map((album) => album.id)).toContain(
			`album-${RADIO_LIBRARY_ALBUM_LIMIT}`,
		);
		expect(result.reduce((sum, album) => sum + album.tracks.length, 0)).toBe(
			RADIO_LIBRARY_TRACK_LIMIT,
		);
	});
});
