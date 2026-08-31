import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db, sqlite } from "../db/index";
import { albums, songs } from "../db/schema";
import { emit } from "../events/event-bus";
import { buildYtSearchTarget } from "../external/youtube-audio";
import { logger } from "../logger";
import {
	type AlbumPlan,
	buildTrackTypeMix,
	normalizeAlbumPlanTracks,
	planAlbumWithLlm,
	type TrackPlan,
} from "./album-planner";
import {
	getRadioSourceSettings,
	pickCoverOfCoverSource,
	type RadioSourceSettings,
	resolveCoverSourceSpec,
} from "./cover-source-service";
import * as playlistService from "./playlist-service";
import { RADIO_PLAYLIST_KEY } from "./radio-constants";
import { getActivePreset } from "./radio-station-presets-service";
import * as settingsService from "./settings-service";
import * as songService from "./song-service";

export { RADIO_PLAYLIST_KEY } from "./radio-constants";
export const RADIO_STATION_ID = "global";
export const RADIO_ALBUM_TRACK_COUNT = 12;
export const RADIO_TRACK_DURATION_SECONDS = 180;
export const RADIO_LIBRARY_ALBUM_LIMIT = 50;
export const RADIO_LIBRARY_TRACK_LIMIT =
	RADIO_LIBRARY_ALBUM_LIMIT * RADIO_ALBUM_TRACK_COUNT;

export type AlbumGenerationKind = "default" | "request" | "manual";

export interface InventoryStats {
	activeListenerCount: number;
	inventoryTarget: number;
	untouchedReadyAlbums: number;
	untouchedGeneratingAlbums: number;
	untouchedActiveAlbums: number;
	incompleteAlbums: number;
	missingAlbumTracks: number;
	inFlightTracks: number;
	queuedRadioTracks: number;
	activeAudioTracks: number;
	readyRadioSongs: number;
	legacySongs: number;
}

export interface InventoryRepairResult {
	repairedAlbums: number;
	repairedTracks: number;
}

export interface RadioChartBucket {
	label: string;
	count: number;
	readyCount?: number;
	playCount?: number;
	likeCount?: number;
	dislikeCount?: number;
	skipCount?: number;
}

export interface RadioAlbumTimingStats {
	completedAlbums: number;
	avgCompletedMs: number | null;
	lastCompletedMs: number | null;
	fastestCompletedMs: number | null;
	slowestCompletedMs: number | null;
	activeAlbums: number;
	oldestActiveMs: number | null;
}

export interface RadioAnalytics {
	generatedGenreSpread: RadioChartBucket[];
	readyGenreSpread: RadioChartBucket[];
	vocalSpread: RadioChartBucket[];
	statusSpread: RadioChartBucket[];
	albumStatusSpread: RadioChartBucket[];
	generationKindSpread: RadioChartBucket[];
	feedbackTotals: {
		likes: number;
		dislikes: number;
		skips: number;
		radioPlays: number;
	};
	albumTiming: RadioAlbumTimingStats;
}

export interface CreateRadioAlbumInput {
	kind?: AlbumGenerationKind;
	prompt?: string;
	requestId?: string | null;
	targetTrackPrompt?: string;
}

const GENRES = [
	"electro soul",
	"future funk",
	"dream pop",
	"alt R&B",
	"synth rock",
	"indie dance",
	"nu disco",
	"ambient pop",
	"breakbeat pop",
	"neo soul",
	"art pop",
	"leftfield house",
];

const DEFAULT_ALBUM_THEMES = [
	"neon rain soul revue",
	"coastal night drive",
	"glass arcade disco",
	"late train dream pop",
	"electric garden funk",
	"silver rooftop R&B",
	"sunset tunnel house",
	"velvet comet indie dance",
	"blue hour synth rock",
	"city lights art pop",
	"moonlit breakbeat radio",
	"soft circuit neo soul",
];

const VOCAL_PLAN = [
	{ track: 1, texture: "female lead, bright stacked chorus" },
	{ track: 2, texture: "male lead, close dry verse" },
	{ track: 3, texture: "duet, call-and-response hook" },
	{ track: 4, texture: "androgynous lead, airy doubles" },
	{ track: 5, texture: "female lead, whispered pre-chorus" },
	{ track: 6, texture: "male lead, falsetto refrain" },
	{ track: 7, texture: "duet, harmonized bridge" },
	{ track: 8, texture: "choir textures, sparse lead lines" },
	{ track: 9, texture: "female lead, low intimate register" },
	{ track: 10, texture: "male lead, gritty ad libs" },
	{ track: 11, texture: "duet, layered octave vocals" },
	{ track: 12, texture: "ensemble outro, blended vocal textures" },
];

const BAND_ADJECTIVES = [
	"Velvet",
	"Neon",
	"Glass",
	"Silver",
	"Electric",
	"Pacific",
	"Midnight",
	"Solar",
	"Chrome",
	"Violet",
	"Paper",
	"Static",
];

const BAND_NOUNS = [
	"Arcade",
	"Choir",
	"Atlas",
	"Parade",
	"Riviera",
	"Bloom",
	"Club",
	"Hearts",
	"Mirrors",
	"Letters",
	"Frequency",
	"Orchestra",
];

const ALBUM_TITLE_SUFFIXES = [
	"After Hours",
	"Night Version",
	"Radio Club",
	"Motion Study",
	"City Lights",
	"Dream Index",
	"Open Channel",
	"Blue Hour",
	"Signal Room",
	"Long Distance",
	"Soft Focus",
	"Wide Awake",
];

const TRACK_TITLE_TEMPLATES = [
	"{theme} Overture",
	"Rooftop Static",
	"Chrome Heartline",
	"Late Signal",
	"Glass Floor",
	"Afterglow Driver",
	"Velvet Overpass",
	"Open Window",
	"Blue Hour Caller",
	"Night Bloom",
	"Frequency Kiss",
	"Last Light Chorus",
];

function seedIndex(seed: string, length: number, offset = 0): number {
	if (length <= 0) return 0;
	const value = [...seed].reduce(
		(sum, char, index) => sum + char.charCodeAt(0) * (index + 1 + offset),
		0,
	);
	return Math.abs(value) % length;
}

function titleCase(input: string): string {
	return input
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

function compactTheme(prompt?: string): string {
	const cleaned = prompt?.replace(/\s+/g, " ").trim();
	if (!cleaned) {
		const seed = createId();
		return DEFAULT_ALBUM_THEMES[seedIndex(seed, DEFAULT_ALBUM_THEMES.length)];
	}
	return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

function themePhrase(theme: string, maxWords = 3): string {
	const words = theme
		.replace(/[^A-Za-z0-9&\s-]/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, maxWords);
	return titleCase(words.join(" ") || "Radio");
}

function buildAlbumTitle(theme: string): string {
	const seed = createId();
	const base = themePhrase(theme, 3);
	const suffix =
		ALBUM_TITLE_SUFFIXES[seedIndex(seed, ALBUM_TITLE_SUFFIXES.length)];
	return `${base} ${suffix}`;
}

function buildBandName(theme: string): string {
	const seed = `${theme}:${createId()}`;
	const adjective = BAND_ADJECTIVES[seedIndex(seed, BAND_ADJECTIVES.length)];
	const noun = BAND_NOUNS[seedIndex(seed, BAND_NOUNS.length, 3)];
	return `${adjective} ${noun}`;
}

function normalizeAlbumKind(value: unknown): AlbumGenerationKind {
	return value === "request" || value === "manual" ? value : "default";
}

function shouldReplaceBandName(value: string | null | undefined): boolean {
	return !value?.trim() || value.trim() === "Infinitune Radio";
}

function isGenericAlbumTitle(value: string | null | undefined): boolean {
	return /^Global Midnight Signal\b/i.test(value?.trim() ?? "");
}

function isGenericTrackTitle(
	value: string | null | undefined,
	albumTitle: string,
): boolean {
	const title = value?.trim() ?? "";
	return (
		!title ||
		title.startsWith(albumTitle) ||
		/^Global Midnight Signal\b/i.test(title)
	);
}

function buildBandPersona(input: {
	bandName: string;
	theme: string;
	kind: AlbumGenerationKind;
}) {
	return {
		name: input.bandName,
		origin: "Infinitune global radio album persona",
		generationKind: input.kind,
		coreSound: input.theme,
		performanceIdentity:
			"Radio-ready studio band with consistent vocal casting, production palette, and cover-art identity across album tracks.",
		reuseGuidance:
			"Reuse this band name and persona when future album themes match the same genre, vocal palette, or listener feedback cluster.",
	};
}

function buildAlbumCoverPrompt(input: {
	title: string;
	bandName: string;
	theme: string;
}) {
	return [
		"Square CD-box front album cover, 1:1 composition, designed for a physical jewel case.",
		`Album title "${input.title}" by band "${input.bandName}".`,
		`Include only these readable words: "${input.bandName}" and "${input.title}".`,
		"Make the text intentional, legible, and integrated like real album typography.",
		"Bold music release artwork, strong thumbnail readability, no mockup, no plastic case, no watermark, no extra text.",
		`Theme: ${input.theme}.`,
	].join(" ");
}

function parseJson<T>(value: string | null): T | null {
	if (!value) return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function coverFromRow(row: {
	cover_url: string | null;
	cover_webp_url: string | null;
	cover_jxl_url: string | null;
}) {
	if (!row.cover_url && !row.cover_webp_url && !row.cover_jxl_url) return null;
	return {
		pngUrl: row.cover_url,
		webpUrl: row.cover_webp_url,
		jxlUrl: row.cover_jxl_url,
	};
}

export async function ensureRadioPlaylist() {
	const existing = await playlistService.getByKey(RADIO_PLAYLIST_KEY);
	if (existing) return existing;

	const settings = await settingsService.getAll();
	return playlistService.create({
		name: "Infinitune Global Radio",
		prompt:
			"Generate exactly three-minute songs for one global synchronized radio station. Keep every song radio-ready, distinct, and suitable for sequenced album playback.",
		llmProvider: settings.textProvider || "openai-codex",
		llmModel: settings.textModel || "",
		mode: "radio",
		playlistKey: RADIO_PLAYLIST_KEY,
		audioDuration: RADIO_TRACK_DURATION_SECONDS,
		aceAutoDuration: false,
		isTemporary: false,
		description: "Hidden generation playlist for the global radio station.",
	});
}

export function getInventoryStats(): InventoryStats {
	const station = sqlite
		.prepare(
			"SELECT active_listener_count as activeListenerCount, inventory_target as inventoryTarget FROM radio_stations WHERE id = ?",
		)
		.get(RADIO_STATION_ID) as
		| { activeListenerCount: number; inventoryTarget: number }
		| undefined;

	const albumRows = sqlite
		.prepare(
			`
				SELECT
					a.id,
					a.status,
					a.first_played_at as firstPlayedAt,
					COUNT(s.id) as trackCount,
					SUM(CASE WHEN s.status = 'ready' THEN 1 ELSE 0 END) as readyTrackCount
				FROM albums a
				LEFT JOIN songs s ON s.album_id = a.id AND s.radio_eligible = 1
				GROUP BY a.id
			`,
		)
		.all() as Array<{
		id: string;
		status: string;
		firstPlayedAt: number | null;
		trackCount: number;
		readyTrackCount: number | null;
	}>;
	const untouchedAlbums = albumRows.filter((row) => row.firstPlayedAt == null);
	const untouchedReadyAlbums = untouchedAlbums.filter(
		(row) =>
			row.status === "ready" &&
			Number(row.trackCount) >= RADIO_ALBUM_TRACK_COUNT &&
			Number(row.readyTrackCount ?? 0) >= RADIO_ALBUM_TRACK_COUNT,
	).length;
	const untouchedGeneratingAlbums = untouchedAlbums.filter(
		(row) =>
			row.status === "generating" &&
			Number(row.trackCount) >= RADIO_ALBUM_TRACK_COUNT,
	).length;
	const incompleteAlbums = untouchedAlbums.filter(
		(row) => Number(row.trackCount) < RADIO_ALBUM_TRACK_COUNT,
	).length;
	const missingAlbumTracks = untouchedAlbums.reduce(
		(sum, row) =>
			sum + Math.max(0, RADIO_ALBUM_TRACK_COUNT - Number(row.trackCount)),
		0,
	);
	const inFlightTracks = Number(
		(
			sqlite
				.prepare(
					`
						SELECT COUNT(*) as count
						FROM songs
						WHERE radio_eligible = 1
							AND status IN (
								'pending',
								'generating_metadata',
								'metadata_ready',
								'submitting_to_ace',
								'generating_audio',
								'saving',
								'retry_pending'
							)
					`,
				)
				.get() as { count: number }
		).count,
	);
	const queuedRadioTracks = Number(
		(
			sqlite
				.prepare(
					`
						SELECT COUNT(*) as count
						FROM songs
						WHERE radio_eligible = 1
							AND status IN (
								'pending',
								'generating_metadata',
								'metadata_ready',
								'submitting_to_ace',
								'retry_pending'
							)
					`,
				)
				.get() as { count: number }
		).count,
	);
	const activeAudioTracks = Number(
		(
			sqlite
				.prepare(
					`
						SELECT COUNT(*) as count
						FROM songs
						WHERE radio_eligible = 1
							AND status IN ('generating_audio', 'saving')
					`,
				)
				.get() as { count: number }
		).count,
	);
	const readyRadioSongs = Number(
		(
			sqlite
				.prepare(
					"SELECT COUNT(*) as count FROM songs WHERE radio_eligible = 1 AND album_id IS NOT NULL AND status = 'ready'",
				)
				.get() as { count: number }
		).count,
	);
	const legacySongs = Number(
		(
			sqlite
				.prepare(
					"SELECT COUNT(*) as count FROM songs WHERE album_id IS NULL OR radio_eligible = 0",
				)
				.get() as { count: number }
		).count,
	);

	return {
		activeListenerCount: station?.activeListenerCount ?? 0,
		inventoryTarget: station?.inventoryTarget ?? 10,
		untouchedReadyAlbums,
		untouchedGeneratingAlbums,
		untouchedActiveAlbums: untouchedReadyAlbums + untouchedGeneratingAlbums,
		incompleteAlbums,
		missingAlbumTracks,
		inFlightTracks,
		queuedRadioTracks,
		activeAudioTracks,
		readyRadioSongs,
		legacySongs,
	};
}

function chartBuckets(sql: string): RadioChartBucket[] {
	return sqlite.prepare(sql).all() as RadioChartBucket[];
}

function numberFromRow(row: unknown, key: string): number {
	if (!row || typeof row !== "object") return 0;
	const value = (row as Record<string, unknown>)[key];
	return Number(value ?? 0);
}

export function getRadioAnalytics(): RadioAnalytics {
	const timingRow = sqlite
		.prepare(
			`
				SELECT
					COUNT(*) as completedAlbums,
					AVG(completed_at - created_at) as avgCompletedMs,
					MIN(completed_at - created_at) as fastestCompletedMs,
					MAX(completed_at - created_at) as slowestCompletedMs
				FROM albums
				WHERE completed_at IS NOT NULL AND completed_at > created_at
			`,
		)
		.get() as Record<string, unknown> | undefined;
	const lastTimingRow = sqlite
		.prepare(
			`
				SELECT completed_at - created_at as lastCompletedMs
				FROM albums
				WHERE completed_at IS NOT NULL AND completed_at > created_at
				ORDER BY completed_at DESC
				LIMIT 1
			`,
		)
		.get() as { lastCompletedMs: number | null } | undefined;
	const now = Date.now();
	const activeRows = sqlite
		.prepare(
			`
				SELECT created_at as createdAt
				FROM albums
				WHERE status = 'generating'
				ORDER BY created_at ASC
			`,
		)
		.all() as Array<{ createdAt: number }>;
	const feedbackRow = sqlite
		.prepare(
			`
				SELECT
					COALESCE(SUM(like_count), 0) as likes,
					COALESCE(SUM(dislike_count), 0) as dislikes,
					COALESCE(SUM(skip_count), 0) as skips,
					COALESCE(SUM(radio_play_count), 0) as radioPlays
				FROM songs
				WHERE radio_eligible = 1 AND album_id IS NOT NULL
			`,
		)
		.get() as Record<string, unknown> | undefined;

	return {
		generatedGenreSpread: chartBuckets(`
			SELECT
				COALESCE(NULLIF(TRIM(genre), ''), 'Unknown') as label,
				COUNT(*) as count,
				SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as readyCount,
				COALESCE(SUM(radio_play_count), 0) as playCount,
				COALESCE(SUM(like_count), 0) as likeCount,
				COALESCE(SUM(dislike_count), 0) as dislikeCount,
				COALESCE(SUM(skip_count), 0) as skipCount
			FROM songs
			WHERE radio_eligible = 1 AND album_id IS NOT NULL
			GROUP BY label
			ORDER BY count DESC, label ASC
			LIMIT 24
		`),
		readyGenreSpread: chartBuckets(`
			SELECT
				COALESCE(NULLIF(TRIM(genre), ''), 'Unknown') as label,
				COUNT(*) as count,
				COALESCE(SUM(radio_play_count), 0) as playCount,
				COALESCE(SUM(like_count), 0) as likeCount,
				COALESCE(SUM(dislike_count), 0) as dislikeCount,
				COALESCE(SUM(skip_count), 0) as skipCount
			FROM songs
			WHERE radio_eligible = 1 AND album_id IS NOT NULL AND status = 'ready'
			GROUP BY label
			ORDER BY count DESC, label ASC
			LIMIT 24
		`),
		vocalSpread: chartBuckets(`
			SELECT
				COALESCE(NULLIF(TRIM(vocal_style), ''), 'Unknown') as label,
				COUNT(*) as count,
				SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as readyCount,
				COALESCE(SUM(radio_play_count), 0) as playCount
			FROM songs
			WHERE radio_eligible = 1 AND album_id IS NOT NULL
			GROUP BY label
			ORDER BY count DESC, label ASC
			LIMIT 24
		`),
		statusSpread: chartBuckets(`
			SELECT status as label, COUNT(*) as count
			FROM songs
			WHERE radio_eligible = 1 AND album_id IS NOT NULL
			GROUP BY status
			ORDER BY count DESC, label ASC
		`),
		albumStatusSpread: chartBuckets(`
			SELECT status as label, COUNT(*) as count
			FROM albums
			GROUP BY status
			ORDER BY count DESC, label ASC
		`),
		generationKindSpread: chartBuckets(`
			SELECT generation_kind as label, COUNT(*) as count
			FROM albums
			GROUP BY generation_kind
			ORDER BY count DESC, label ASC
		`),
		feedbackTotals: {
			likes: numberFromRow(feedbackRow, "likes"),
			dislikes: numberFromRow(feedbackRow, "dislikes"),
			skips: numberFromRow(feedbackRow, "skips"),
			radioPlays: numberFromRow(feedbackRow, "radioPlays"),
		},
		albumTiming: {
			completedAlbums: numberFromRow(timingRow, "completedAlbums"),
			avgCompletedMs:
				timingRow?.avgCompletedMs == null
					? null
					: Number(timingRow.avgCompletedMs),
			lastCompletedMs: lastTimingRow?.lastCompletedMs ?? null,
			fastestCompletedMs:
				timingRow?.fastestCompletedMs == null
					? null
					: Number(timingRow.fastestCompletedMs),
			slowestCompletedMs:
				timingRow?.slowestCompletedMs == null
					? null
					: Number(timingRow.slowestCompletedMs),
			activeAlbums: activeRows.length,
			oldestActiveMs:
				activeRows.length === 0
					? null
					: Math.max(...activeRows.map((row) => now - Number(row.createdAt))),
		},
	};
}

function buildResearchContext(theme: string) {
	const lastAlbums = sqlite
		.prepare(
			"SELECT title, band_name as bandName, theme, generation_kind as generationKind FROM albums ORDER BY created_at DESC LIMIT 10",
		)
		.all() as Array<{
		title: string;
		bandName: string | null;
		theme: string;
		generationKind: string;
	}>;
	const recentSongs = sqlite
		.prepare(
			`
				SELECT s.title, s.genre, s.vocal_style as vocalStyle, s.like_count as likeCount, s.dislike_count as dislikeCount
				FROM radio_plays rp
				JOIN songs s ON s.id = rp.song_id
				ORDER BY rp.started_at DESC
				LIMIT 30
			`,
		)
		.all() as Array<{
		title: string | null;
		genre: string | null;
		vocalStyle: string | null;
		likeCount: number;
		dislikeCount: number;
	}>;

	return {
		theme,
		lastAlbums,
		recentSongs,
		chartRadioListResearch: {
			source: "radio-default-context",
			summary:
				"Favor fresh hooks, contemporary radio pacing, vivid genre contrast, and durable three-minute arrangements.",
		},
		libraryAnalytics: getRadioAnalytics(),
	};
}

function buildTrackMetadata(input: {
	albumTitle: string;
	bandName: string;
	theme: string;
	stationGenrePrompt?: string;
	stationVocalStyle?: string;
	trackNumber: number;
	kind: AlbumGenerationKind;
	targetTrackPrompt?: string;
	coverPrompt?: string;
}) {
	const genre = GENRES[(input.trackNumber - 1) % GENRES.length];
	const vocal =
		input.stationVocalStyle ||
		VOCAL_PLAN[input.trackNumber - 1]?.texture ||
		"layered vocals";
	const trackTitle = TRACK_TITLE_TEMPLATES[input.trackNumber - 1].replace(
		"{theme}",
		themePhrase(input.theme, 2),
	);
	const targetHint =
		input.targetTrackPrompt && input.trackNumber === 4
			? ` Request anchor: ${input.targetTrackPrompt}`
			: "";
	const moodByThird =
		input.trackNumber <= 4
			? "charged"
			: input.trackNumber <= 8
				? "glowing"
				: "late-night";
	const energy =
		input.trackNumber === 12
			? "medium"
			: input.trackNumber <= 3
				? "high"
				: input.trackNumber % 3 === 0
					? "low"
					: "medium";

	return {
		title: trackTitle,
		artistName: input.bandName,
		genre,
		subGenre: `${genre} transmission`,
		lyrics: `[Verse]\n${input.theme} on the wire tonight\nEvery signal lands in time\n\n[Chorus]\nHold the frequency, keep it bright\nThree minutes moving through the light`,
		caption: `${input.bandName} - ${trackTitle}. From ${input.albumTitle}, track ${input.trackNumber}.${input.stationGenrePrompt ? ` Station direction: ${input.stationGenrePrompt}.` : ""} Vocal direction: ${vocal}.${targetHint}`,
		vocalStyle: vocal,
		coverPrompt: input.coverPrompt,
		bpm: 96 + ((input.trackNumber * 7) % 42),
		keyScale: input.trackNumber % 2 === 0 ? "A minor" : "C major",
		timeSignature: "4/4",
		audioDuration: RADIO_TRACK_DURATION_SECONDS,
		mood: moodByThird,
		energy,
		era: "near-future",
		instruments: [
			"drums",
			"bass",
			input.trackNumber % 2 === 0 ? "analog synths" : "clean guitars",
			"vocal stacks",
		],
		tags: ["global-radio", input.kind, `track-${input.trackNumber}`],
		themes: [input.theme, "broadcast", "shared listening"],
		language: "english",
		description: `${RADIO_TRACK_DURATION_SECONDS}-second global radio album track with ${vocal}, ${genre} production, and album-coherent transitions.`,
	};
}

/** Recently used cover search targets, so the planner avoids repeats. */
function listRecentCoverTargets(limit = 40): string[] {
	const rows = sqlite
		.prepare(
			`
				SELECT source_url as sourceUrl
				FROM songs
				WHERE radio_eligible = 1 AND source_url LIKE 'ytsearch%'
				ORDER BY created_at DESC
				LIMIT ?
			`,
		)
		.all(limit) as Array<{ sourceUrl: string }>;
	return rows.map((row) => row.sourceUrl.replace(/^ytsearch\d*:/, ""));
}

interface TrackCreateOpts {
	aceTaskType?: string;
	sourceSongId?: string;
	sourceAudioPath?: string;
	sourceUrl?: string;
	coverNoiseStrength?: number;
}

/**
 * Resolve a planned track's reference audio. Cover-of-cover falls back to a
 * normal cover when the station has no covers yet; a cover with no
 * acquirable source falls back to a plain new track (empty opts).
 */
async function resolveTrackSourceOpts(
	spec: TrackPlan,
	albumGenre: string,
	sourceSettings: RadioSourceSettings,
): Promise<TrackCreateOpts> {
	if (spec.type === "new") return {};

	const coverOpts = {
		aceTaskType: "cover",
		coverNoiseStrength: sourceSettings.coverNoiseStrength,
	};

	if (spec.type === "cover-of-cover") {
		const sourceSongId = await pickCoverOfCoverSource();
		if (sourceSongId) return { ...coverOpts, sourceSongId };
	}

	let searchTarget: string | null = null;
	if (spec.searchTarget) {
		try {
			searchTarget = buildYtSearchTarget(
				`${spec.searchTarget.title} ${spec.searchTarget.artist} official audio`,
			);
		} catch (err) {
			logger.warn(
				{ trackTitle: spec.title, searchTarget: spec.searchTarget, err },
				"Planner search target unusable",
			);
		}
	}
	const sourceSpec = await resolveCoverSourceSpec({
		albumGenre,
		searchTarget,
		settings: sourceSettings,
	});
	switch (sourceSpec.kind) {
		case "seeded":
		case "search":
			return { ...coverOpts, sourceUrl: sourceSpec.sourceUrl };
		case "nas":
			return { ...coverOpts, sourceAudioPath: sourceSpec.sourceAudioPath };
		case "none":
			// If this fires on every album, cover-first has silently become
			// all-new: check planner searchTargets, the seeded pool, NAS dir.
			logger.warn(
				{
					trackTitle: spec.title,
					type: spec.type,
					albumGenre,
					hadSearchTarget: !!searchTarget,
					nasConfigured: !!sourceSettings.sourceLibraryDir,
				},
				"No cover source acquirable; track demoted to new",
			);
			return {};
	}
}

export async function createRadioAlbum(input: CreateRadioAlbumInput = {}) {
	const playlist = await ensureRadioPlaylist();
	const kind = input.kind ?? "default";
	const preset = getActivePreset();
	const theme = compactTheme(input.prompt ?? preset?.genrePrompt);

	const sourceSettings = await getRadioSourceSettings();
	const trackTypes = buildTrackTypeMix(sourceSettings, RADIO_ALBUM_TRACK_COUNT);

	let plan: AlbumPlan | null = null;
	try {
		plan = await planAlbumWithLlm({
			theme,
			stationGenrePrompt: preset?.genrePrompt,
			stationVocalStyle: preset?.vocalStyle ?? undefined,
			kind,
			trackTypes,
			targetTrackPrompt: input.targetTrackPrompt,
			recentAlbums: sqlite
				.prepare(
					"SELECT title, band_name as bandName, theme FROM albums ORDER BY created_at DESC LIMIT 10",
				)
				.all() as Array<{
				title: string;
				bandName: string | null;
				theme: string;
			}>,
			recentCoverTargets: listRecentCoverTargets(),
		});
	} catch (err) {
		// Full error object on purpose: planner failures are schema/auth
		// debugging cases and carry no remote-content risk (unlike yt-dlp).
		logger.warn(
			{ err },
			"Album planner LLM failed; falling back to deterministic album",
		);
	}

	if (!plan) {
		return createRadioAlbumFallback(input, theme, kind, {
			genrePrompt: preset?.genrePrompt,
			vocalStyle: preset?.vocalStyle ?? undefined,
		});
	}

	const albumId = createId();
	const now = Date.now();
	const title = plan.album.albumTitle;
	const bandName = plan.album.bandName;
	const albumTheme = `${plan.album.targetGenre} · ${plan.album.vibe}`;
	const bandPersona = buildBandPersona({ bandName, theme: albumTheme, kind });
	const coverPrompt = buildAlbumCoverPrompt({
		title,
		bandName,
		theme: albumTheme,
	});
	const research = {
		...buildResearchContext(albumTheme),
		plannerAlbum: plan.album,
		trackTypes,
	};
	const firstOrderIndex = await songService.getNextOrderIndex(playlist.id);
	const normalizedTracks = normalizeAlbumPlanTracks(plan, trackTypes);

	const [album] = await db
		.insert(albums)
		.values({
			id: albumId,
			createdAt: now,
			title,
			bandName,
			theme: albumTheme,
			status: "generating",
			generationKind: kind,
			coverPrompt,
			trendResearchJson: JSON.stringify(research),
			bandPersonaJson: JSON.stringify(bandPersona),
			vocalPlanJson: JSON.stringify(
				normalizedTracks.map((track, index) => ({
					track: index + 1,
					texture: track?.vocalStyle ?? VOCAL_PLAN[index]?.texture,
				})),
			),
			requestId: input.requestId ?? null,
		})
		.returning();

	for (
		let trackNumber = 1;
		trackNumber <= RADIO_ALBUM_TRACK_COUNT;
		trackNumber++
	) {
		const spec = normalizedTracks[trackNumber - 1];
		const fallbackMetadata = buildTrackMetadata({
			albumTitle: title,
			bandName,
			theme: albumTheme,
			stationGenrePrompt: preset?.genrePrompt,
			stationVocalStyle: preset?.vocalStyle ?? undefined,
			trackNumber,
			kind,
			targetTrackPrompt: input.targetTrackPrompt,
			coverPrompt: trackNumber === 1 ? coverPrompt : undefined,
		});

		let metadata: Record<string, unknown> = fallbackMetadata;
		let sourceOpts: TrackCreateOpts = {};
		if (spec) {
			sourceOpts = await resolveTrackSourceOpts(
				spec,
				plan.album.targetGenre,
				sourceSettings,
			);
			const effectiveType = sourceOpts.aceTaskType ? spec.type : "new";
			metadata = {
				...fallbackMetadata,
				title: spec.title,
				genre: plan.album.targetGenre,
				subGenre: plan.album.vibe,
				lyrics: spec.lyrics,
				caption: spec.caption,
				vocalStyle: spec.vocalStyle,
				bpm: spec.bpm ?? fallbackMetadata.bpm,
				keyScale: spec.keyScale ?? fallbackMetadata.keyScale,
				mood: spec.mood ?? fallbackMetadata.mood,
				energy: spec.energy ?? fallbackMetadata.energy,
				era: plan.album.era,
				tags: ["global-radio", kind, `track-${trackNumber}`, effectiveType],
				description: `${RADIO_TRACK_DURATION_SECONDS}-second ${effectiveType} track in ${plan.album.targetGenre}: ${spec.caption}`,
			};
		}

		await songService.createWithMetadata(
			playlist.id,
			firstOrderIndex + trackNumber - 1,
			metadata,
			{
				albumId,
				albumTrackNumber: trackNumber,
				radioEligible: true,
				requestId: input.requestId ?? null,
				...sourceOpts,
			},
		);
	}

	logger.info(
		{
			albumId,
			title,
			bandName,
			kind,
			targetGenre: plan.album.targetGenre,
			trackTypes,
		},
		"Cover-first radio album generation job created",
	);
	return album;
}

/**
 * Deterministic album path (pre-planner behavior): template metadata, all
 * tracks text2music. Used when the LLM planner fails so the radio never
 * stalls.
 */
async function createRadioAlbumFallback(
	input: CreateRadioAlbumInput,
	theme: string,
	kind: AlbumGenerationKind,
	stationIntent: {
		genrePrompt?: string;
		vocalStyle?: string;
	} = {},
) {
	const playlist = await ensureRadioPlaylist();
	const title = buildAlbumTitle(theme);
	const bandName = buildBandName(theme);
	const albumId = createId();
	const now = Date.now();
	const bandPersona = buildBandPersona({ bandName, theme, kind });
	const coverPrompt = buildAlbumCoverPrompt({ title, bandName, theme });
	const research = buildResearchContext(theme);
	const firstOrderIndex = await songService.getNextOrderIndex(playlist.id);

	const [album] = await db
		.insert(albums)
		.values({
			id: albumId,
			createdAt: now,
			title,
			bandName,
			theme,
			status: "generating",
			generationKind: kind,
			coverPrompt,
			trendResearchJson: JSON.stringify(research),
			bandPersonaJson: JSON.stringify(bandPersona),
			vocalPlanJson: JSON.stringify(VOCAL_PLAN),
			requestId: input.requestId ?? null,
		})
		.returning();

	for (
		let trackNumber = 1;
		trackNumber <= RADIO_ALBUM_TRACK_COUNT;
		trackNumber++
	) {
		const metadata = buildTrackMetadata({
			albumTitle: title,
			bandName,
			theme,
			stationGenrePrompt: stationIntent.genrePrompt,
			stationVocalStyle: stationIntent.vocalStyle,
			trackNumber,
			kind,
			targetTrackPrompt: input.targetTrackPrompt,
			coverPrompt: trackNumber === 1 ? coverPrompt : undefined,
		});
		await songService.createWithMetadata(
			playlist.id,
			firstOrderIndex + trackNumber - 1,
			metadata,
			{
				albumId,
				albumTrackNumber: trackNumber,
				radioEligible: true,
				requestId: input.requestId ?? null,
			},
		);
	}

	logger.info(
		{ albumId, title, bandName, kind },
		"Radio album generation job created (fallback)",
	);
	return album;
}

export async function repairIncompleteRadioAlbums(): Promise<InventoryRepairResult> {
	const playlist = await ensureRadioPlaylist();
	const albumRows = sqlite
		.prepare(
			`
				SELECT
					a.id,
					a.title,
					a.theme,
					a.generation_kind as generationKind,
					a.band_name as bandName,
					a.cover_prompt as coverPrompt,
					a.request_id as requestId,
					COUNT(s.id) as trackCount
				FROM albums a
				LEFT JOIN songs s ON s.album_id = a.id AND s.radio_eligible = 1
				WHERE a.first_played_at IS NULL
				GROUP BY a.id
				ORDER BY a.created_at ASC
			`,
		)
		.all() as Array<{
		id: string;
		title: string;
		theme: string;
		generationKind: string | null;
		bandName: string | null;
		coverPrompt: string | null;
		requestId: string | null;
		trackCount: number;
	}>;

	let nextOrderIndex = await songService.getNextOrderIndex(playlist.id);
	let repairedAlbums = 0;
	let repairedTracks = 0;

	for (const album of albumRows) {
		const existingTracks = sqlite
			.prepare(
				`
					SELECT id, title, album_track_number as trackNumber
					FROM songs
					WHERE album_id = ? AND radio_eligible = 1
				`,
			)
			.all(album.id) as Array<{
			id: string;
			title: string | null;
			trackNumber: number | null;
		}>;
		const existingTrackNumbers = new Set(
			existingTracks
				.map((track) => Number(track.trackNumber))
				.filter((trackNumber) => Number.isInteger(trackNumber)),
		);

		const theme = compactTheme(album.theme);
		const kind = normalizeAlbumKind(album.generationKind);
		const albumTitle = isGenericAlbumTitle(album.title)
			? buildAlbumTitle(theme)
			: album.title;
		const replacingBandName = shouldReplaceBandName(album.bandName);
		const bandName = replacingBandName
			? buildBandName(theme)
			: album.bandName?.trim() || buildBandName(theme);
		const coverPrompt =
			replacingBandName || !album.coverPrompt?.trim()
				? buildAlbumCoverPrompt({ title: albumTitle, bandName, theme })
				: album.coverPrompt.trim();

		if (
			album.title !== albumTitle ||
			album.bandName !== bandName ||
			album.coverPrompt !== coverPrompt ||
			!album.coverPrompt?.trim()
		) {
			const bandPersonaJson = JSON.stringify(
				buildBandPersona({ bandName, theme, kind }),
			);
			sqlite
				.prepare(
					`
						UPDATE albums
						SET title = ?,
							band_name = ?,
							cover_prompt = ?,
							band_persona_json = CASE
								WHEN ? = 1 THEN ?
								ELSE COALESCE(band_persona_json, ?)
							END
						WHERE id = ?
					`,
				)
				.run(
					albumTitle,
					bandName,
					coverPrompt,
					replacingBandName ? 1 : 0,
					bandPersonaJson,
					bandPersonaJson,
					album.id,
				);
		}

		sqlite
			.prepare(
				`
					UPDATE songs
					SET artist_name = ?
					WHERE album_id = ?
						AND radio_eligible = 1
						AND (artist_name IS NULL OR artist_name = '' OR artist_name = 'Infinitune Radio')
				`,
			)
			.run(bandName, album.id);
		for (const track of existingTracks) {
			const trackNumber = Number(track.trackNumber);
			if (!Number.isInteger(trackNumber)) continue;
			if (!isGenericTrackTitle(track.title, album.title)) continue;
			const metadata = buildTrackMetadata({
				albumTitle,
				bandName,
				theme,
				trackNumber,
				kind,
				coverPrompt: trackNumber === 1 ? coverPrompt : undefined,
			});
			sqlite
				.prepare(
					`
						UPDATE songs
						SET title = ?,
							artist_name = ?,
							caption = ?,
							description = ?,
							cover_prompt = CASE
								WHEN album_track_number = 1 THEN ?
								ELSE cover_prompt
							END
						WHERE id = ?
					`,
				)
				.run(
					metadata.title,
					bandName,
					metadata.caption,
					metadata.description,
					coverPrompt,
					track.id,
				);
		}
		sqlite
			.prepare(
				`
					UPDATE songs
					SET cover_prompt = ?
					WHERE album_id = ?
						AND radio_eligible = 1
						AND album_track_number = 1
						AND (? = 1 OR cover_prompt IS NULL OR cover_prompt = '')
				`,
			)
			.run(coverPrompt, album.id, replacingBandName ? 1 : 0);

		let albumTrackRepairCount = 0;
		for (
			let trackNumber = 1;
			trackNumber <= RADIO_ALBUM_TRACK_COUNT;
			trackNumber++
		) {
			if (existingTrackNumbers.has(trackNumber)) continue;
			const metadata = buildTrackMetadata({
				albumTitle,
				bandName,
				theme,
				trackNumber,
				kind,
				coverPrompt: trackNumber === 1 ? coverPrompt : undefined,
			});
			await songService.createWithMetadata(
				playlist.id,
				nextOrderIndex,
				metadata,
				{
					albumId: album.id,
					albumTrackNumber: trackNumber,
					radioEligible: true,
					requestId: album.requestId,
				},
			);
			nextOrderIndex++;
			repairedTracks++;
			albumTrackRepairCount++;
		}

		if (albumTrackRepairCount > 0) {
			repairedAlbums++;
			sqlite
				.prepare(
					"UPDATE albums SET status = 'generating', ready_at = NULL, completed_at = NULL WHERE id = ?",
				)
				.run(album.id);
		} else {
			await markAlbumReadyIfComplete(album.id);
		}
	}

	if (repairedAlbums > 0) {
		logger.info(
			{ repairedAlbums, repairedTracks },
			"Repaired incomplete radio album inventory",
		);
	}

	return { repairedAlbums, repairedTracks };
}

/**
 * Serializes inventory top-ups. Overlapping triggers (listener activation +
 * album_ready/song-start handlers) would each read the same stale inventory
 * and both enqueue a full target of albums, and concurrent repairs could
 * duplicate missing tracks. Chaining ensures each run sees the previous
 * run's results before computing its deficit.
 */
let topUpQueue: Promise<unknown> = Promise.resolve();

export function topUpInventory(opts?: {
	force?: boolean;
}): Promise<Awaited<ReturnType<typeof runTopUpInventory>>> {
	const run = topUpQueue
		.catch(() => undefined)
		.then(() => runTopUpInventory(opts));
	topUpQueue = run.catch(() => undefined);
	return run;
}

async function runTopUpInventory(opts?: { force?: boolean }) {
	const force = opts?.force === true;
	const repair = await repairIncompleteRadioAlbums();
	const stats = getInventoryStats();
	if (!force && stats.activeListenerCount <= 0) {
		return {
			created: 0,
			...repair,
			stats,
			skipped: "no-active-listeners" as const,
		};
	}

	const target = stats.inventoryTarget;
	const desiredActiveAlbums = force ? target + 1 : target;
	const deficit = Math.max(
		0,
		desiredActiveAlbums - stats.untouchedActiveAlbums,
	);
	// Manual force adds at most one extra album beyond the target.
	const createCount = force ? Math.min(1, deficit) : deficit;
	if (force && createCount === 0) {
		return {
			created: 0,
			...repair,
			stats,
			skipped: "manual-extra-already-queued" as const,
		};
	}
	let created = 0;
	for (let i = 0; i < createCount; i++) {
		await createRadioAlbum({ kind: force ? "manual" : "default" });
		created++;
	}
	return { created, ...repair, stats: getInventoryStats(), skipped: null };
}

export async function markAlbumReadyIfComplete(albumId: string | null) {
	if (!albumId) return;
	const rows = await db
		.select({ status: songs.status })
		.from(songs)
		.where(eq(songs.albumId, albumId));
	if (rows.length !== RADIO_ALBUM_TRACK_COUNT) return;
	if (!rows.every((row) => row.status === "ready")) return;
	const now = Date.now();
	// Only emit on an actual status transition. Re-emitting for an
	// already-ready album would re-trigger topUpInventory (via the
	// radio.album_ready handler), which re-enters here → unbounded loop.
	const updated = await db
		.update(albums)
		.set({ status: "ready", readyAt: now, completedAt: now })
		.where(and(eq(albums.id, albumId), ne(albums.status, "ready")))
		.returning({ id: albums.id });
	if (updated.length === 0) return;
	emit("radio.album_ready", { albumId });
}

export async function markAlbumFirstPlayed(
	albumId: string | null,
	at = Date.now(),
) {
	if (!albumId) return;
	await db
		.update(albums)
		.set({ firstPlayedAt: at })
		.where(and(eq(albums.id, albumId), isNull(albums.firstPlayedAt)));
}

export async function listRadioAlbums() {
	const albumRows = sqlite
		.prepare("SELECT * FROM albums ORDER BY created_at DESC LIMIT ?")
		.all(RADIO_LIBRARY_ALBUM_LIMIT) as Array<Record<string, unknown>>;
	const trackRows = sqlite
		.prepare(
			`
				SELECT s.*
				FROM songs s
				INNER JOIN (
					SELECT id, created_at
					FROM albums
					ORDER BY created_at DESC
					LIMIT ?
				) recent_albums ON recent_albums.id = s.album_id
				WHERE s.radio_eligible = 1
				ORDER BY recent_albums.created_at DESC, s.album_track_number ASC
				LIMIT ?
			`,
		)
		.all(RADIO_LIBRARY_ALBUM_LIMIT, RADIO_LIBRARY_TRACK_LIMIT) as Array<
		Record<string, unknown>
	>;
	const tracksByAlbum = new Map<string, Array<Record<string, unknown>>>();
	for (const track of trackRows) {
		const albumId = String(track.album_id);
		const tracks = tracksByAlbum.get(albumId) ?? [];
		tracks.push(track);
		tracksByAlbum.set(albumId, tracks);
	}

	return albumRows.map((row) => ({
		id: String(row.id),
		createdAt: Number(row.created_at),
		title: String(row.title),
		bandName: (row.band_name as string | null) ?? "Infinitune Radio",
		theme: String(row.theme),
		status: String(row.status),
		generationKind: String(row.generation_kind),
		coverPrompt: row.cover_prompt as string | null,
		cover: coverFromRow({
			cover_url: row.cover_url as string | null,
			cover_webp_url: row.cover_webp_url as string | null,
			cover_jxl_url: row.cover_jxl_url as string | null,
		}),
		trendResearch: parseJson(row.trend_research_json as string | null),
		bandPersona: parseJson(row.band_persona_json as string | null),
		vocalPlan: parseJson(row.vocal_plan_json as string | null),
		requestId: row.request_id as string | null,
		firstPlayedAt: row.first_played_at as number | null,
		readyAt: row.ready_at as number | null,
		completedAt: row.completed_at as number | null,
		tracks: (tracksByAlbum.get(String(row.id)) ?? []).map((track) => ({
			id: String(track.id),
			createdAt: Number(track.created_at),
			playlistId: String(track.playlist_id),
			orderIndex: Number(track.order_index),
			title: track.title as string | null,
			artistName: track.artist_name as string | null,
			genre: track.genre as string | null,
			subGenre: track.sub_genre as string | null,
			lyrics: track.lyrics as string | null,
			caption: track.caption as string | null,
			coverPrompt: track.cover_prompt as string | null,
			cover: coverFromRow({
				cover_url: track.cover_url as string | null,
				cover_webp_url: track.cover_webp_url as string | null,
				cover_jxl_url: track.cover_jxl_url as string | null,
			}),
			bpm: track.bpm == null ? null : Number(track.bpm),
			keyScale: track.key_scale as string | null,
			timeSignature: track.time_signature as string | null,
			vocalStyle: track.vocal_style as string | null,
			mood: track.mood as string | null,
			energy: track.energy as string | null,
			era: track.era as string | null,
			instruments: parseJson<string[]>(track.instruments as string | null),
			tags: parseJson<string[]>(track.tags as string | null),
			themes: parseJson<string[]>(track.themes as string | null),
			language: track.language as string | null,
			description: track.description as string | null,
			status: String(track.status),
			aceTaskId: track.ace_task_id as string | null,
			aceSubmittedAt: track.ace_submitted_at as number | null,
			aceAudioPath: track.ace_audio_path as string | null,
			storagePath: track.storage_path as string | null,
			generationStartedAt: track.generation_started_at as number | null,
			generationCompletedAt: track.generation_completed_at as number | null,
			metadataProcessingMs: track.metadata_processing_ms as number | null,
			coverProcessingMs: track.cover_processing_ms as number | null,
			audioProcessingMs: track.audio_processing_ms as number | null,
			errorMessage: track.error_message as string | null,
			retryCount: track.retry_count as number | null,
			erroredAtStatus: track.errored_at_status as string | null,
			cancelledAtStatus: track.cancelled_at_status as string | null,
			llmProvider: track.llm_provider as string | null,
			llmModel: track.llm_model as string | null,
			personaExtract: track.persona_extract as string | null,
			audioUrl: track.audio_url as string | null,
			audioDuration: Number(
				track.audio_duration ?? RADIO_TRACK_DURATION_SECONDS,
			),
			albumTrackNumber: Number(track.album_track_number),
			likeCount: Number(track.like_count ?? 0),
			dislikeCount: Number(track.dislike_count ?? 0),
			skipCount: Number(track.skip_count ?? 0),
			radioPlayCount: Number(track.radio_play_count ?? 0),
		})),
	}));
}

export async function getReadyRadioSongIds() {
	const rows = await db
		.select({ id: songs.id })
		.from(songs)
		.where(
			and(
				eq(songs.radioEligible, true),
				eq(songs.status, "ready"),
				isNotNull(songs.albumId),
			),
		);
	return rows.map((row) => row.id);
}
