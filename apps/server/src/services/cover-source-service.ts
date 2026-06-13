import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index";
import { type CoverSource, coverSources, songs } from "../db/schema";
import { downloadCacheKey } from "../external/youtube-audio";
import { logger } from "../logger";
import { resolveSongAudioFile } from "../utils/song-audio-path";
import * as settingsService from "./settings-service";

const execFileAsync = promisify(execFile);

const TRANSCODE_DIR = path.resolve(
	process.env.REIMAGINE_SOURCES_DIR || "data/reimagine-sources",
	"nas-cache",
);
const TRANSCODE_TIMEOUT_MS = 120_000;

const AUDIO_EXTENSIONS = new Set([
	".mp3",
	".m4a",
	".aac",
	".flac",
	".wav",
	".ogg",
	".opus",
	".wma",
]);

// ─── Radio source settings ──────────────────────────────────────────

export interface RadioSourceSettings {
	coversPerAlbum: number;
	newPerAlbum: number;
	coverOfCoverPerAlbum: number;
	randomFill: number;
	/** Probability a cover is acquired via online search (vs the NAS library) */
	searchRatio: number;
	sourceLibraryDir: string;
	/** ACE cover_noise_strength: 0 = loose interpretation, 1 = close to source */
	coverNoiseStrength: number;
}

export const DEFAULT_RADIO_SOURCE_SETTINGS: RadioSourceSettings = {
	coversPerAlbum: 8,
	newPerAlbum: 1,
	coverOfCoverPerAlbum: 1,
	randomFill: 2,
	searchRatio: 0.75,
	sourceLibraryDir: "",
	coverNoiseStrength: 0.5,
};

function parseCount(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseRatio(value: string | undefined, fallback: number): number {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
		? parsed
		: fallback;
}

export function parseRadioSourceSettings(
	raw: Record<string, string>,
): RadioSourceSettings {
	const defaults = DEFAULT_RADIO_SOURCE_SETTINGS;
	return {
		coversPerAlbum: parseCount(
			raw.radioCoversPerAlbum,
			defaults.coversPerAlbum,
		),
		newPerAlbum: parseCount(raw.radioNewPerAlbum, defaults.newPerAlbum),
		coverOfCoverPerAlbum: parseCount(
			raw.radioCoverOfCoverPerAlbum,
			defaults.coverOfCoverPerAlbum,
		),
		randomFill: parseCount(raw.radioRandomFill, defaults.randomFill),
		searchRatio: parseRatio(raw.radioSearchRatio, defaults.searchRatio),
		sourceLibraryDir: raw.radioSourceLibraryDir?.trim() ?? "",
		coverNoiseStrength: parseRatio(
			raw.radioCoverNoiseStrength,
			defaults.coverNoiseStrength,
		),
	};
}

export async function getRadioSourceSettings(): Promise<RadioSourceSettings> {
	return parseRadioSourceSettings(await settingsService.getAll());
}

// ─── Seeded source pool (cover_sources) ─────────────────────────────

export async function addCoverSource(url: string, genreTag?: string | null) {
	const [row] = await db
		.insert(coverSources)
		.values({ url: url.trim(), genreTag: genreTag?.trim() || null })
		.returning();
	return row;
}

export async function listCoverSources(): Promise<CoverSource[]> {
	return db.select().from(coverSources).orderBy(asc(coverSources.createdAt));
}

export async function deleteCoverSource(id: string): Promise<boolean> {
	const result = await db
		.delete(coverSources)
		.where(eq(coverSources.id, id))
		.returning({ id: coverSources.id });
	return result.length > 0;
}

/**
 * Claim the oldest pending seeded source for an album. Sources with a genre
 * tag only match albums whose target genre mentions that tag (case
 * insensitive); untagged sources match any album. Marks the row used.
 */
export async function claimSeededSource(
	albumGenre: string,
): Promise<CoverSource | null> {
	const pending = await db
		.select()
		.from(coverSources)
		.where(eq(coverSources.status, "pending"))
		.orderBy(asc(coverSources.createdAt));
	const genreLower = albumGenre.toLowerCase();
	const matches = pending.filter(
		(row) =>
			!row.genreTag?.trim() ||
			genreLower.includes(row.genreTag.trim().toLowerCase()),
	);
	for (const match of matches) {
		// Conditional update makes the claim atomic against concurrent album
		// creation; a row someone else claimed first is simply skipped.
		const claimed = await db
			.update(coverSources)
			.set({ status: "used", lastUsedAt: Date.now() })
			.where(
				and(eq(coverSources.id, match.id), eq(coverSources.status, "pending")),
			)
			.returning({ id: coverSources.id });
		if (claimed.length > 0) return match;
	}
	return null;
}

export async function markSourceUsed(url: string, resolvedAudioPath: string) {
	await db
		.update(coverSources)
		.set({ resolvedAudioPath, lastUsedAt: Date.now() })
		.where(eq(coverSources.url, url));
}

export async function markSourceFailed(url: string) {
	await db
		.update(coverSources)
		.set({ status: "failed", lastUsedAt: Date.now() })
		.where(eq(coverSources.url, url));
}

// ─── NAS library ────────────────────────────────────────────────────

export interface NasStatus {
	configured: boolean;
	exists: boolean;
	fileCount: number;
	/** Scan failure (permissions, stale mount, …) — distinct from "empty" */
	error: string | null;
}

function listNasAudioFiles(libraryDir: string): {
	files: string[];
	error: string | null;
} {
	try {
		const entries = fs.readdirSync(libraryDir, {
			recursive: true,
			withFileTypes: true,
		});
		return {
			files: entries
				.filter(
					(entry) =>
						entry.isFile() &&
						AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
				)
				.map((entry) => path.resolve(entry.parentPath, entry.name)),
			error: null,
		};
	} catch (err) {
		// An unreadable library must be distinguishable from an empty one,
		// otherwise a bad mount silently routes every cover to online search.
		const message = err instanceof Error ? err.message : String(err);
		logger.warn({ libraryDir, err: { message } }, "NAS library scan failed");
		return { files: [], error: message };
	}
}

export function getNasStatus(libraryDir: string): NasStatus {
	const configured = !!libraryDir.trim();
	if (!configured) {
		return { configured: false, exists: false, fileCount: 0, error: null };
	}
	const exists = fs.existsSync(libraryDir);
	if (!exists) {
		return { configured, exists, fileCount: 0, error: null };
	}
	const scan = listNasAudioFiles(libraryDir);
	return {
		configured,
		exists,
		fileCount: scan.files.length,
		error: scan.error,
	};
}

/**
 * Pick a random audio file from the NAS library. Non-mp3 files are
 * transcoded via ffmpeg into a cache keyed by source path, so repeat picks
 * are free. Returns null when the library is unset, empty, or unreadable.
 */
export async function pickNasFile(libraryDir: string): Promise<string | null> {
	if (!libraryDir.trim()) return null;
	const { files } = listNasAudioFiles(libraryDir);
	if (files.length === 0) return null;
	const source = files[Math.floor(Math.random() * files.length)];
	if (path.extname(source).toLowerCase() === ".mp3") return source;

	fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
	const cached = path.join(TRANSCODE_DIR, `${downloadCacheKey(source)}.mp3`);
	if (fs.existsSync(cached)) return cached;

	try {
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-i",
				source,
				"-vn",
				"-codec:a",
				"libmp3lame",
				"-q:a",
				"2",
				cached,
			],
			{ timeout: TRANSCODE_TIMEOUT_MS },
		);
		return cached;
	} catch (err) {
		// Local NAS files carry no remote-content concern, so the ffmpeg
		// stderr tail is safe and useful (codec/container detail).
		const stderr = (err as { stderr?: string }).stderr;
		logger.warn(
			{
				source,
				err: { message: err instanceof Error ? err.message : String(err) },
				stderrTail: typeof stderr === "string" ? stderr.slice(-500) : undefined,
			},
			"NAS audio transcode failed",
		);
		fs.rmSync(cached, { force: true });
		return null;
	}
}

// ─── Cover-of-cover ─────────────────────────────────────────────────

/**
 * Pick a random ready radio cover song whose rendered audio is reachable, to
 * serve as the reference for a cover-of-cover track. Returns null when no
 * covers exist yet (callers fall back to a normal cover).
 */
export async function pickCoverOfCoverSource(): Promise<string | null> {
	const candidates = await db
		.select({ id: songs.id, storagePath: songs.storagePath })
		.from(songs)
		.where(
			and(
				eq(songs.radioEligible, true),
				eq(songs.status, "ready"),
				eq(songs.aceTaskType, "cover"),
				isNotNull(songs.storagePath),
			),
		);
	const playable = candidates.filter((row) =>
		resolveSongAudioFile(row.storagePath),
	);
	if (playable.length === 0) {
		if (candidates.length > 0) {
			// Covers exist but none of their audio files are reachable —
			// likely a storage outage, not the benign "no covers yet" case.
			logger.warn(
				{ candidateCount: candidates.length },
				"No cover-of-cover source: all cover audio files unreachable",
			);
		}
		return null;
	}
	return playable[Math.floor(Math.random() * playable.length)].id;
}

// ─── Acquisition routing ────────────────────────────────────────────

export type CoverSourceSpec =
	| { kind: "seeded"; sourceUrl: string }
	| { kind: "search"; sourceUrl: string }
	| { kind: "nas"; sourceAudioPath: string }
	| { kind: "none" };

/** Pure ratio decision, extracted for tests. */
export function chooseAcquisitionMethod(
	random: number,
	searchRatio: number,
): "search" | "nas" {
	return random < searchRatio ? "search" : "nas";
}

/**
 * Resolve where a cover slot's reference audio comes from, in priority
 * order: seeded pool → search/NAS by configured ratio, with each leg falling
 * back to the other when unavailable.
 */
export async function resolveCoverSourceSpec(input: {
	albumGenre: string;
	searchTarget: string | null;
	settings: RadioSourceSettings;
}): Promise<CoverSourceSpec> {
	const seeded = await claimSeededSource(input.albumGenre);
	if (seeded) return { kind: "seeded", sourceUrl: seeded.url };

	const method = chooseAcquisitionMethod(
		Math.random(),
		input.settings.searchRatio,
	);
	const trySearch = (): CoverSourceSpec | null =>
		input.searchTarget
			? { kind: "search", sourceUrl: input.searchTarget }
			: null;
	const tryNas = async (): Promise<CoverSourceSpec | null> => {
		const file = await pickNasFile(input.settings.sourceLibraryDir);
		return file ? { kind: "nas", sourceAudioPath: file } : null;
	};

	if (method === "search") {
		return trySearch() ?? (await tryNas()) ?? { kind: "none" };
	}
	return (await tryNas()) ?? trySearch() ?? { kind: "none" };
}
