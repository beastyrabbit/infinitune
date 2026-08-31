import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sqlite } from "../db/index";
import { logger } from "../logger";
import { isPrivateIp } from "../utils/public-http";

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR = path.resolve(
	process.env.REIMAGINE_SOURCES_DIR || "data/reimagine-sources",
);
const DOWNLOAD_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_DURATION_SECONDS = 600;
const MAX_SEARCH_QUERY_LENGTH = 200;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const CACHE_METADATA_HEADROOM_BYTES = 64 * 1024;
const DEFAULT_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_FILE_PATTERN = /^([a-f0-9]{32})\./;
const CACHE_RETURN_LEASE_MS = 60_000;
const ACTIVE_SOURCE_STATUSES = [
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"generating_audio",
	"saving",
	"retry_pending",
] as const;
const returnedCacheLeases = new Map<string, number>();

function positiveIntegerSetting(
	value: string | undefined,
	fallback: number,
): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const CACHE_MAX_BYTES = Math.max(
	MAX_SOURCE_BYTES + CACHE_METADATA_HEADROOM_BYTES,
	positiveIntegerSetting(
		process.env.REIMAGINE_CACHE_MAX_BYTES,
		DEFAULT_CACHE_MAX_BYTES,
	),
);
const CACHE_TTL_MS =
	positiveIntegerSetting(
		process.env.REIMAGINE_CACHE_TTL_HOURS,
		DEFAULT_CACHE_TTL_MS / (60 * 60 * 1000),
	) *
	60 *
	60 *
	1000;

/**
 * Bound yt-dlp to known media extractors. This kills the arbitrary-URL SSRF
 * vector at the source: even a URL that passes the DNS pre-check (or a
 * redirect/DNS-rebind after it) can't be fetched by the "generic" extractor.
 */
const EXTRACTOR_ALLOWLIST = "youtube.*,soundcloud.*,bandcamp.*";

export interface YoutubeAudioResult {
	filePath: string;
	durationSeconds: number;
	title: string;
}

/** Strip credentials from a URL before it reaches logs. */
function redactUrl(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl);
		parsed.username = "";
		parsed.password = "";
		return parsed.toString();
	} catch {
		return rawUrl;
	}
}

/**
 * Reduce an error to message + code for logging. Never log the raw execFile
 * error object — it carries stdout/stderr that can echo fetched-host content.
 */
function errSummary(err: unknown): { message: string; code?: unknown } {
	if (err instanceof Error) {
		return { message: err.message, code: (err as { code?: unknown }).code };
	}
	return { message: String(err) };
}

/** Stable cache key for a download target (URL or ytsearch query). */
export function downloadCacheKey(target: string): string {
	return createHash("sha256").update(target).digest("hex").slice(0, 32);
}

interface CacheMeta {
	durationSeconds: number;
	title: string;
}

interface CacheEntry {
	cacheKey: string;
	filePaths: string[];
	lastUsedAt: number;
	sizeBytes: number;
}

export interface DownloadCachePruneOptions {
	directory: string;
	maxBytes: number;
	ttlMs: number;
	now?: number;
	excludeCacheKey?: string;
	excludeCacheKeys?: ReadonlySet<string>;
}

/** Remove expired entries, then least-recently-used entries until under quota. */
export function pruneDownloadCache({
	directory,
	maxBytes,
	ttlMs,
	now = Date.now(),
	excludeCacheKey,
	excludeCacheKeys,
}: DownloadCachePruneOptions): { removedEntries: number; sizeBytes: number } {
	let dirEntries: fs.Dirent[];
	try {
		dirEntries = fs.readdirSync(directory, { withFileTypes: true });
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") {
			return { removedEntries: 0, sizeBytes: 0 };
		}
		throw err;
	}

	const grouped = new Map<string, CacheEntry>();
	for (const entry of dirEntries) {
		if (!entry.isFile()) continue;
		const match = CACHE_FILE_PATTERN.exec(entry.name);
		if (!match) continue;
		const filePath = path.join(directory, entry.name);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(filePath);
		} catch {
			continue;
		}
		const cacheKey = match[1];
		const current = grouped.get(cacheKey) ?? {
			cacheKey,
			filePaths: [],
			lastUsedAt: 0,
			sizeBytes: 0,
		};
		current.filePaths.push(filePath);
		current.lastUsedAt = Math.max(current.lastUsedAt, stat.mtimeMs);
		current.sizeBytes += stat.size;
		grouped.set(cacheKey, current);
	}

	const entries = [...grouped.values()];
	let sizeBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0);
	let removedEntries = 0;
	const removeEntry = (entry: CacheEntry) => {
		for (const filePath of entry.filePaths) {
			fs.rmSync(filePath, { force: true });
		}
		sizeBytes -= entry.sizeBytes;
		removedEntries++;
	};

	const retained: CacheEntry[] = [];
	for (const entry of entries) {
		const excluded =
			entry.cacheKey === excludeCacheKey ||
			excludeCacheKeys?.has(entry.cacheKey);
		if (!excluded && now - entry.lastUsedAt >= ttlMs) {
			removeEntry(entry);
		} else {
			retained.push(entry);
		}
	}

	for (const entry of retained
		.filter(
			(entry) =>
				entry.cacheKey !== excludeCacheKey &&
				!excludeCacheKeys?.has(entry.cacheKey),
		)
		.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
		if (sizeBytes <= maxBytes) break;
		removeEntry(entry);
	}

	return { removedEntries, sizeBytes: Math.max(0, sizeBytes) };
}

function cacheKeyFromFilePath(filePath: string): string | null {
	if (path.dirname(path.resolve(filePath)) !== DOWNLOAD_DIR) return null;
	return CACHE_FILE_PATTERN.exec(path.basename(filePath))?.[1] ?? null;
}

function protectedCacheKeys(now = Date.now()): Set<string> {
	const protectedKeys = new Set<string>();
	for (const [cacheKey, expiresAt] of returnedCacheLeases) {
		if (expiresAt > now) protectedKeys.add(cacheKey);
		else returnedCacheLeases.delete(cacheKey);
	}

	try {
		const placeholders = ACTIVE_SOURCE_STATUSES.map(() => "?").join(", ");
		const rows = sqlite
			.prepare(
				`SELECT source_audio_path AS filePath
				 FROM songs
				 WHERE source_audio_path IS NOT NULL
				   AND status IN (${placeholders})`,
			)
			.all(...ACTIVE_SOURCE_STATUSES) as Array<{ filePath: string }>;
		for (const row of rows) {
			const cacheKey = cacheKeyFromFilePath(row.filePath);
			if (cacheKey) protectedKeys.add(cacheKey);
		}
	} catch {
		// Schema setup and isolated utility tests can run before `songs` exists.
	}

	return protectedKeys;
}

function leaseReturnedCacheEntry(cacheKey: string): void {
	returnedCacheLeases.set(cacheKey, Date.now() + CACHE_RETURN_LEASE_MS);
}

function pruneRuntimeCache(
	maxBytes: number,
	excludeCacheKey?: string,
): { removedEntries: number; sizeBytes: number } {
	try {
		const result = pruneDownloadCache({
			directory: DOWNLOAD_DIR,
			maxBytes,
			ttlMs: CACHE_TTL_MS,
			excludeCacheKey,
			excludeCacheKeys: protectedCacheKeys(),
		});
		if (result.removedEntries > 0) {
			logger.info(
				{ removedEntries: result.removedEntries, sizeBytes: result.sizeBytes },
				"Pruned reference audio cache",
			);
		}
		if (result.sizeBytes > maxBytes) {
			throw new Error("Reference audio cache remains above its byte quota");
		}
		return result;
	} catch (err) {
		logger.warn(
			{ err: errSummary(err) },
			"Reference audio cache pruning failed",
		);
		throw new Error("Reference audio cache capacity check failed");
	}
}

export type AudioDurationProbe = (filePath: string) => Promise<string>;

const runFfprobe: AudioDurationProbe = async (filePath) => {
	const { stdout } = await execFileAsync(
		"ffprobe",
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			filePath,
		],
		{ timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 },
	);
	return stdout;
};

export async function probeAudioDuration(
	filePath: string,
	probe: AudioDurationProbe = runFfprobe,
): Promise<number> {
	const durationSeconds = Number((await probe(filePath)).trim());
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new Error("ffprobe did not return a valid duration");
	}
	if (durationSeconds > MAX_DURATION_SECONDS) {
		throw new Error(
			`Source is longer than ${MAX_DURATION_SECONDS / 60} minutes`,
		);
	}
	return durationSeconds;
}

async function readCachedResult(
	cacheKey: string,
): Promise<YoutubeAudioResult | null> {
	const filePath = path.join(DOWNLOAD_DIR, `${cacheKey}.mp3`);
	let size = 0;
	try {
		size = fs.statSync(filePath).size;
	} catch {
		return null; // not cached
	}
	if (size === 0) {
		// Zero-byte file from a crashed write would poison the cache forever
		logger.warn({ cacheKey }, "Discarding empty cached download");
		fs.rmSync(filePath, { force: true });
		return null;
	}
	let meta: Partial<CacheMeta> | null = null;
	try {
		meta = JSON.parse(
			fs.readFileSync(path.join(DOWNLOAD_DIR, `${cacheKey}.json`), "utf8"),
		) as Partial<CacheMeta>;
	} catch (err) {
		// Sidecar missing or corrupt — the audio file alone is still usable.
		if ((err as { code?: string }).code !== "ENOENT") {
			logger.warn(
				{ cacheKey, err: errSummary(err) },
				"Download cache meta unreadable; using defaults",
			);
		}
	}
	let durationSeconds: number;
	try {
		durationSeconds = await probeAudioDuration(filePath);
	} catch (err) {
		logger.warn(
			{ cacheKey, err: errSummary(err) },
			"Cached reference audio could not be measured; discarding it",
		);
		fs.rmSync(filePath, { force: true });
		fs.rmSync(path.join(DOWNLOAD_DIR, `${cacheKey}.json`), { force: true });
		return null;
	}
	return {
		filePath,
		durationSeconds,
		title:
			typeof meta?.title === "string" && meta.title
				? meta.title
				: "External Source",
	};
}

function writeCacheMeta(cacheKey: string, meta: CacheMeta): void {
	try {
		fs.writeFileSync(
			path.join(DOWNLOAD_DIR, `${cacheKey}.json`),
			JSON.stringify(meta),
		);
	} catch (err) {
		logger.warn(
			{ cacheKey, err: errSummary(err) },
			"Failed to write download cache meta",
		);
	}
}

function removeCacheEntryFiles(cacheKey: string): void {
	let entries: string[];
	try {
		entries = fs.readdirSync(DOWNLOAD_DIR);
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		if (entry.startsWith(`${cacheKey}.`)) {
			fs.rmSync(path.join(DOWNLOAD_DIR, entry), { force: true });
		}
	}
}

/**
 * SSRF guard: only public http(s) hosts may be fetched. Rejects URLs whose
 * hostname resolves to loopback, RFC1918, link-local, or other private
 * ranges, so the downloader can't be pointed at internal services. Defense in
 * depth alongside the extractor allowlist.
 */
async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error("Invalid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Only http(s) URLs are supported");
	}
	const addresses = await lookup(parsed.hostname, { all: true }).catch(
		() => [],
	);
	if (addresses.length === 0) {
		throw new Error("URL host did not resolve");
	}
	if (addresses.some((entry) => isPrivateIp(entry.address))) {
		throw new Error("URL host is not allowed");
	}
}

/**
 * Run yt-dlp against a target (URL or ytsearch query) and cache the MP3 under
 * DOWNLOAD_DIR keyed by the target hash, so repeat requests are free.
 */
async function runYtDlpOnce(
	target: string,
	logTarget: string,
): Promise<YoutubeAudioResult> {
	fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
	const cacheKey = downloadCacheKey(target);
	const cached = await readCachedResult(cacheKey);
	if (cached) {
		const now = new Date();
		try {
			fs.utimesSync(cached.filePath, now, now);
		} catch {
			// The already-open cache entry remains usable; pruning can retry later.
		}
		try {
			pruneRuntimeCache(CACHE_MAX_BYTES, cacheKey);
		} catch {
			// A cache hit does not add bytes. Serve it, but block the next miss if
			// the capacity check still cannot run.
		}
		logger.info({ target: logTarget }, "Reference audio served from cache");
		leaseReturnedCacheEntry(cacheKey);
		return cached;
	}
	removeCacheEntryFiles(cacheKey);
	pruneRuntimeCache(CACHE_MAX_BYTES - MAX_SOURCE_BYTES);

	const outTemplate = path.join(DOWNLOAD_DIR, `${cacheKey}.%(ext)s`);
	const args = [
		"--no-playlist",
		"--js-runtimes",
		"node",
		"--use-extractors",
		EXTRACTOR_ALLOWLIST,
		"--extract-audio",
		"--audio-format",
		"mp3",
		"--max-filesize",
		"100M",
		"--match-filter",
		`duration <= ${MAX_DURATION_SECONDS}`,
		"--no-simulate",
		"--print",
		"after_move:%(duration)s\t%(title)s\t%(filepath)s",
		"-o",
		outTemplate,
		// "--" prevents a target from ever being parsed as a yt-dlp flag
		"--",
		target,
	];

	logger.info({ target: logTarget }, "Downloading reference audio via yt-dlp");
	let stdout: string;
	let stderr: string;
	try {
		({ stdout, stderr } = await execFileAsync("yt-dlp", args, {
			timeout: DOWNLOAD_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
		}));
	} catch (err) {
		removeCacheEntryFiles(cacheKey);
		// Don't surface yt-dlp output to clients or logs — it can echo response
		// content from the fetched host.
		logger.warn(
			{ target: logTarget, err: errSummary(err) },
			"yt-dlp download failed",
		);
		throw new Error("Download failed or source is unsupported");
	}

	const line = stdout
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.at(-1);
	const [, title, filePath] = (line ?? "").split("\t");
	if (!filePath || !fs.existsSync(filePath)) {
		removeCacheEntryFiles(cacheKey);
		// yt-dlp exits 0 when --match-filter skips the download
		if (stderr.includes("duration") || stdout.includes("skipping")) {
			throw new Error(
				`Source is longer than ${MAX_DURATION_SECONDS / 60} minutes or could not be downloaded`,
			);
		}
		throw new Error("yt-dlp did not produce an audio file");
	}
	if (fs.statSync(filePath).size > MAX_SOURCE_BYTES) {
		removeCacheEntryFiles(cacheKey);
		throw new Error("Downloaded source exceeds the cache file-size limit");
	}

	let durationSeconds: number;
	try {
		durationSeconds = await probeAudioDuration(filePath);
	} catch (err) {
		removeCacheEntryFiles(cacheKey);
		logger.warn(
			{ target: logTarget, err: errSummary(err) },
			"Downloaded reference audio could not be measured",
		);
		throw new Error("Downloaded audio is invalid or too long");
	}
	const result: YoutubeAudioResult = {
		filePath,
		durationSeconds,
		title: title?.trim() || "External Source",
	};
	writeCacheMeta(cacheKey, {
		durationSeconds: result.durationSeconds,
		title: result.title,
	});
	try {
		pruneRuntimeCache(CACHE_MAX_BYTES, cacheKey);
	} catch (err) {
		fs.rmSync(filePath, { force: true });
		fs.rmSync(path.join(DOWNLOAD_DIR, `${cacheKey}.json`), { force: true });
		throw err;
	}
	leaseReturnedCacheEntry(cacheKey);
	return result;
}

// Serialize cache mutations. Concurrent 100 MB downloads could each pass the
// same preflight quota check and collectively exceed the configured bound.
let downloadQueue: Promise<unknown> = Promise.resolve();

export function serializeDownloadCacheMutation<T>(
	task: () => Promise<T>,
): Promise<T> {
	const run = downloadQueue.catch(() => undefined).then(task);
	downloadQueue = run.catch(() => undefined);
	return run;
}

function runYtDlp(
	target: string,
	logTarget: string,
): Promise<YoutubeAudioResult> {
	return serializeDownloadCacheMutation(() => runYtDlpOnce(target, logTarget));
}

/**
 * Download the audio track of a YouTube/SoundCloud/Bandcamp URL as MP3 for
 * use as an ACE cover-task reference. Rejects sources longer than 10 minutes.
 * Results are cached under data/reimagine-sources keyed by URL hash.
 */
export async function downloadYoutubeAudio(
	url: string,
): Promise<YoutubeAudioResult> {
	await assertPublicHttpUrl(url);
	return runYtDlp(url, redactUrl(url));
}

/** Normalize a free-text search query for yt-dlp's ytsearch extractor. */
export function buildYtSearchTarget(query: string): string {
	const cleaned = query
		// Control chars would corrupt the yt-dlp target; strip them defensively.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char strip
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_SEARCH_QUERY_LENGTH);
	if (!cleaned) throw new Error("Empty search query");
	return `ytsearch1:${cleaned}`;
}

/**
 * Search YouTube for a track and download the first result's audio as MP3.
 * Accepts either a plain query or a prebuilt "ytsearchN:" target. The search
 * path never touches arbitrary hosts — it is bounded by the extractor
 * allowlist, so no public-IP pre-check is needed.
 */
export async function downloadAudioBySearch(
	query: string,
): Promise<YoutubeAudioResult> {
	const target = /^ytsearch\d*:/.test(query)
		? buildYtSearchTarget(query.replace(/^ytsearch\d*:/, ""))
		: buildYtSearchTarget(query);
	return runYtDlp(target, target);
}
