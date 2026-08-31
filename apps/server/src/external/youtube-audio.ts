import { type ChildProcess, execFile, spawn } from "node:child_process";
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
const MAX_CACHE_ENTRY_RESERVATION_BYTES =
	2 * MAX_SOURCE_BYTES + CACHE_METADATA_HEADROOM_BYTES;
const CACHE_SIZE_POLL_MS = 100;
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
let runtimeCacheCoordinator: DownloadCacheCoordinator | undefined;

function positiveIntegerSetting(
	value: string | undefined,
	fallback: number,
): number {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const CACHE_MAX_BYTES = Math.max(
	MAX_CACHE_ENTRY_RESERVATION_BYTES,
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
const YT_DLP_RESULT_TEMPLATE =
	'after_move:{"duration":%(duration)j,"title":%(title)j,"filepath":%(filepath)j}';

export interface YoutubeAudioResult {
	filePath: string;
	durationSeconds: number;
	title: string;
}

interface CacheArtifactUsage {
	totalBytes: number;
	maxFileBytes: number;
}

function cacheArtifactUsage(
	directory: string,
	cacheKey: string,
): CacheArtifactUsage {
	let entries: string[];
	try {
		entries = fs.readdirSync(directory);
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") {
			return { totalBytes: 0, maxFileBytes: 0 };
		}
		throw err;
	}

	let totalBytes = 0;
	let maxFileBytes = 0;
	for (const entry of entries) {
		if (!entry.startsWith(`${cacheKey}.`)) continue;
		try {
			const sizeBytes = fs.statSync(path.join(directory, entry)).size;
			totalBytes += sizeBytes;
			maxFileBytes = Math.max(maxFileBytes, sizeBytes);
		} catch {
			// yt-dlp may atomically rename or remove an artifact between reads.
		}
	}
	return { totalBytes, maxFileBytes };
}

export interface DownloadCacheSizeGuardOptions {
	directory: string;
	cacheKey: string;
	maxEntryBytes: number;
	maxFileBytes: number;
	onExceeded: () => void;
	intervalMs?: number;
}

export interface DownloadCacheSizeGuard {
	check(): boolean;
	exceeded(): boolean;
	stop(): void;
}

/**
 * Enforce the reservation while yt-dlp is still running. Its own
 * --max-filesize check is only reliable when the source declares a size, so
 * chunked/unknown-length downloads also need a measured local guard.
 */
export function createDownloadCacheSizeGuard({
	directory,
	cacheKey,
	maxEntryBytes,
	maxFileBytes,
	onExceeded,
	intervalMs = CACHE_SIZE_POLL_MS,
}: DownloadCacheSizeGuardOptions): DownloadCacheSizeGuard {
	let didExceed = false;
	let stopped = false;
	let timer: ReturnType<typeof setInterval> | undefined;

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (timer) clearInterval(timer);
		timer = undefined;
	};
	const check = () => {
		if (stopped) return didExceed;
		const usage = cacheArtifactUsage(directory, cacheKey);
		if (
			usage.totalBytes <= maxEntryBytes &&
			usage.maxFileBytes <= maxFileBytes
		) {
			return false;
		}
		didExceed = true;
		stop();
		onExceeded();
		return true;
	};

	timer = setInterval(check, intervalMs);
	timer.unref?.();
	return { check, exceeded: () => didExceed, stop };
}

export function parseYtDlpDownloadOutput(
	stdout: string,
	expectedFilePath: string,
): YoutubeAudioResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim());
	} catch {
		throw new Error("yt-dlp returned invalid download metadata");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("yt-dlp returned invalid download metadata");
	}

	const { duration, title, filepath } = parsed as Record<string, unknown>;
	if (
		typeof duration !== "number" ||
		!Number.isFinite(duration) ||
		duration <= 0 ||
		duration > MAX_DURATION_SECONDS ||
		typeof title !== "string" ||
		!title.trim() ||
		typeof filepath !== "string" ||
		!filepath ||
		path.resolve(filepath) !== path.resolve(expectedFilePath)
	) {
		throw new Error("yt-dlp returned invalid download metadata");
	}

	return {
		filePath: path.resolve(filepath),
		durationSeconds: duration,
		title: title.trim(),
	};
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
	reservedCacheKeys?: ReadonlySet<string>;
}

/** Remove expired entries, then least-recently-used entries until under quota. */
export function pruneDownloadCache({
	directory,
	maxBytes,
	ttlMs,
	now = Date.now(),
	excludeCacheKey,
	excludeCacheKeys,
	reservedCacheKeys,
}: DownloadCachePruneOptions): {
	removedEntries: number;
	sizeBytes: number;
	quotaSizeBytes: number;
} {
	let dirEntries: fs.Dirent[];
	try {
		dirEntries = fs.readdirSync(directory, { withFileTypes: true });
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") {
			return { removedEntries: 0, sizeBytes: 0, quotaSizeBytes: 0 };
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
	// A reservation already charges the full worst-case size for an in-flight
	// download. Its partial file must not be charged a second time here.
	let quotaSizeBytes = entries.reduce(
		(total, entry) =>
			reservedCacheKeys?.has(entry.cacheKey) ? total : total + entry.sizeBytes,
		0,
	);
	let removedEntries = 0;
	const removeEntry = (entry: CacheEntry) => {
		for (const filePath of entry.filePaths) {
			fs.rmSync(filePath, { force: true });
		}
		sizeBytes -= entry.sizeBytes;
		if (!reservedCacheKeys?.has(entry.cacheKey)) {
			quotaSizeBytes -= entry.sizeBytes;
		}
		removedEntries++;
	};

	const retained: CacheEntry[] = [];
	for (const entry of entries) {
		const excluded =
			entry.cacheKey === excludeCacheKey ||
			excludeCacheKeys?.has(entry.cacheKey) ||
			reservedCacheKeys?.has(entry.cacheKey);
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
				!excludeCacheKeys?.has(entry.cacheKey) &&
				!reservedCacheKeys?.has(entry.cacheKey),
		)
		.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
		if (quotaSizeBytes <= maxBytes) break;
		removeEntry(entry);
	}

	return {
		removedEntries,
		sizeBytes: Math.max(0, sizeBytes),
		quotaSizeBytes: Math.max(0, quotaSizeBytes),
	};
}

type MaybePromise<T> = T | Promise<T>;

export interface DownloadCacheCoordinatorOptions {
	maxBytes: number;
	reservationBytes: number;
	ensureCapacity: (
		availableBytes: number,
		reservedCacheKeys: ReadonlySet<string>,
	) => MaybePromise<void>;
	cleanup: (cacheKey: string) => MaybePromise<void>;
}

export interface DownloadCacheCoordinator {
	serialize<T>(task: () => MaybePromise<T>): Promise<T>;
	runDeduplicated<T>(cacheKey: string, task: () => Promise<T>): Promise<T>;
	runReserved<T>(
		cacheKey: string,
		download: () => Promise<T>,
		commit?: (result: T) => MaybePromise<void>,
	): Promise<T>;
	protectedCacheKeys(): Set<string>;
	reservedCacheKeys(): Set<string>;
	reservedBytes(): number;
}

/**
 * Coordinate cache mutations without holding the mutation queue while the
 * downloader or probe is running. Each miss reserves its worst-case size, so
 * concurrent writers cannot collectively pass the same capacity preflight.
 */
export function createDownloadCacheCoordinator({
	maxBytes,
	reservationBytes,
	ensureCapacity,
	cleanup,
}: DownloadCacheCoordinatorOptions): DownloadCacheCoordinator {
	let mutationQueue: Promise<unknown> = Promise.resolve();
	const reservations = new Map<string, { bytes: number; token: symbol }>();
	const inFlight = new Map<string, Promise<unknown>>();

	const serialize = <T>(task: () => MaybePromise<T>): Promise<T> => {
		const run = mutationQueue.catch(() => undefined).then(task);
		mutationQueue = run.catch(() => undefined);
		return run;
	};
	const reservedBytes = () =>
		[...reservations.values()].reduce(
			(total, reservation) => total + reservation.bytes,
			0,
		);
	const reservedCacheKeys = () => new Set(reservations.keys());
	const protectedCacheKeysForCoordinator = () =>
		new Set([...inFlight.keys(), ...reservations.keys()]);

	const runDeduplicated = <T>(
		cacheKey: string,
		task: () => Promise<T>,
	): Promise<T> => {
		const existing = inFlight.get(cacheKey);
		if (existing) return existing as Promise<T>;

		// Deferring the task until the next microtask guarantees the map entry is
		// visible before any task body can begin.
		const promise = Promise.resolve().then(task);
		inFlight.set(cacheKey, promise);
		const clear = () => {
			if (inFlight.get(cacheKey) === promise) inFlight.delete(cacheKey);
		};
		void promise.then(clear, clear);
		return promise;
	};

	const runReserved = async <T>(
		cacheKey: string,
		download: () => Promise<T>,
		commit: (result: T) => MaybePromise<void> = () => undefined,
	): Promise<T> => {
		const token = Symbol(cacheKey);
		try {
			await serialize(async () => {
				if (reservations.has(cacheKey)) {
					throw new Error("Download cache key is already reserved");
				}
				await cleanup(cacheKey);
				reservations.set(cacheKey, { bytes: reservationBytes, token });
				try {
					const availableBytes = maxBytes - reservedBytes();
					if (availableBytes < 0) {
						throw new Error("Download cache capacity check failed");
					}
					await ensureCapacity(availableBytes, reservedCacheKeys());
				} catch (err) {
					if (reservations.get(cacheKey)?.token === token) {
						reservations.delete(cacheKey);
					}
					throw err;
				}
			});

			const result = await download();
			await serialize(async () => {
				if (reservations.get(cacheKey)?.token !== token) {
					throw new Error("Download cache reservation was lost");
				}
				reservations.delete(cacheKey);
				await commit(result);
				await ensureCapacity(maxBytes - reservedBytes(), reservedCacheKeys());
			});
			return result;
		} catch (err) {
			try {
				await serialize(async () => {
					if (reservations.get(cacheKey)?.token === token) {
						reservations.delete(cacheKey);
					}
					await cleanup(cacheKey);
				});
			} catch (cleanupErr) {
				throw new AggregateError(
					[err, cleanupErr],
					"Download failed and cache cleanup failed",
				);
			}
			throw err;
		}
	};

	return {
		serialize,
		runDeduplicated,
		runReserved,
		protectedCacheKeys: protectedCacheKeysForCoordinator,
		reservedCacheKeys,
		reservedBytes,
	};
}

function cacheKeyFromFilePath(filePath: string): string | null {
	if (path.dirname(path.resolve(filePath)) !== DOWNLOAD_DIR) return null;
	return CACHE_FILE_PATTERN.exec(path.basename(filePath))?.[1] ?? null;
}

function protectedCacheKeys(now = Date.now()): Set<string> {
	const protectedKeys =
		runtimeCacheCoordinator?.protectedCacheKeys() ?? new Set<string>();
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
		return null;
	}
	if (size > MAX_SOURCE_BYTES) {
		logger.warn(
			{ cacheKey, sizeBytes: size },
			"Discarding oversized cached download",
		);
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

function cachedEntryWithinSizeLimit(cacheKey: string): boolean {
	const audioPath = path.join(DOWNLOAD_DIR, `${cacheKey}.mp3`);
	let audioSize: number;
	try {
		audioSize = fs.statSync(audioPath).size;
	} catch {
		return false;
	}

	let entrySize = 0;
	try {
		for (const entry of fs.readdirSync(DOWNLOAD_DIR)) {
			if (!entry.startsWith(`${cacheKey}.`)) continue;
			try {
				entrySize += fs.statSync(path.join(DOWNLOAD_DIR, entry)).size;
			} catch {
				// A concurrently removed sidecar contributes no cache bytes.
			}
		}
	} catch (err) {
		if ((err as { code?: string }).code === "ENOENT") return false;
		throw err;
	}

	if (
		audioSize <= 0 ||
		audioSize > MAX_SOURCE_BYTES ||
		entrySize > MAX_SOURCE_BYTES + CACHE_METADATA_HEADROOM_BYTES
	) {
		logger.warn(
			{ cacheKey, audioSizeBytes: audioSize, entrySizeBytes: entrySize },
			"Discarding invalid or oversized cached download",
		);
		removeCacheEntryFiles(cacheKey);
		return false;
	}
	return true;
}

function pruneRuntimeCache(
	maxBytes: number,
	excludeCacheKey?: string,
	reservedCacheKeys?: ReadonlySet<string>,
): { removedEntries: number; sizeBytes: number; quotaSizeBytes: number } {
	try {
		const result = pruneDownloadCache({
			directory: DOWNLOAD_DIR,
			maxBytes,
			ttlMs: CACHE_TTL_MS,
			excludeCacheKey,
			excludeCacheKeys: protectedCacheKeys(),
			reservedCacheKeys,
		});
		if (result.removedEntries > 0) {
			logger.info(
				{ removedEntries: result.removedEntries, sizeBytes: result.sizeBytes },
				"Pruned reference audio cache",
			);
		}
		if (result.quotaSizeBytes > maxBytes) {
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

function pruneRuntimeCacheWithReservations(
	excludeCacheKey?: string,
): ReturnType<typeof pruneRuntimeCache> {
	const reservedBytes = runtimeCacheCoordinator?.reservedBytes() ?? 0;
	return pruneRuntimeCache(
		CACHE_MAX_BYTES - reservedBytes,
		excludeCacheKey,
		runtimeCacheCoordinator?.reservedCacheKeys(),
	);
}

runtimeCacheCoordinator = createDownloadCacheCoordinator({
	maxBytes: CACHE_MAX_BYTES,
	reservationBytes: MAX_CACHE_ENTRY_RESERVATION_BYTES,
	ensureCapacity: (availableBytes, reservedCacheKeys) => {
		pruneRuntimeCache(availableBytes, undefined, reservedCacheKeys);
	},
	cleanup: removeCacheEntryFiles,
});

function runtimeCoordinator(): DownloadCacheCoordinator {
	if (!runtimeCacheCoordinator) {
		throw new Error("Reference audio cache coordinator is unavailable");
	}
	return runtimeCacheCoordinator;
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

function terminateProcessTree(child: ChildProcess): void {
	if (child.pid && process.platform !== "win32") {
		try {
			process.kill(-child.pid, "SIGKILL");
			return;
		} catch {
			// Fall through when the process group has already exited.
		}
	}
	try {
		child.kill("SIGKILL");
	} catch {
		// The process already exited.
	}
}

function runYtDlpProcess(
	args: string[],
	cacheKey: string,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		let guard: DownloadCacheSizeGuard | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let outputBytes = 0;
		const executable = process.platform === "linux" ? "prlimit" : "yt-dlp";
		const processArgs =
			process.platform === "linux"
				? [`--fsize=${MAX_SOURCE_BYTES}`, "--", "yt-dlp", ...args]
				: args;
		const child = spawn(executable, processArgs, {
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			guard?.stop();
			if (error) {
				reject(error);
				return;
			}
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
			});
		};
		const collect = (chunks: Buffer[], chunk: Buffer) => {
			outputBytes += chunk.length;
			if (outputBytes > 4 * 1024 * 1024) {
				terminateProcessTree(child);
				finish(new Error("yt-dlp output exceeded its buffer limit"));
				return;
			}
			chunks.push(chunk);
		};

		child.stdout.on("data", (chunk: Buffer) => collect(stdoutChunks, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderrChunks, chunk));
		child.on("error", (error) => finish(error));
		child.on("close", (code) => {
			guard?.check();
			if (guard?.exceeded()) {
				finish(
					new Error("Reference audio download exceeded its cache reservation"),
				);
				return;
			}
			if (code !== 0) {
				finish(new Error(`yt-dlp exited with code ${code ?? "unknown"}`));
				return;
			}
			finish();
		});
		timeout = setTimeout(() => {
			terminateProcessTree(child);
			finish(new Error("yt-dlp timed out"));
		}, DOWNLOAD_TIMEOUT_MS);

		guard = createDownloadCacheSizeGuard({
			directory: DOWNLOAD_DIR,
			cacheKey,
			maxEntryBytes: MAX_CACHE_ENTRY_RESERVATION_BYTES,
			maxFileBytes: MAX_SOURCE_BYTES,
			onExceeded: () => terminateProcessTree(child),
		});
	});
}

/**
 * Run yt-dlp against a target (URL or ytsearch query) and cache the MP3 under
 * DOWNLOAD_DIR keyed by the target hash, so repeat requests are free.
 */
async function runYtDlpOnce(
	target: string,
	logTarget: string,
	cacheKey: string,
): Promise<YoutubeAudioResult> {
	const coordinator = runtimeCoordinator();
	const hasCacheCandidate = await coordinator.serialize(() => {
		fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
		return cachedEntryWithinSizeLimit(cacheKey);
	});
	const cached = hasCacheCandidate ? await readCachedResult(cacheKey) : null;
	if (cached) {
		await coordinator.serialize(() => {
			const now = new Date();
			try {
				fs.utimesSync(cached.filePath, now, now);
			} catch {
				// The already-open entry remains usable; pruning can retry later.
			}
			try {
				pruneRuntimeCacheWithReservations(cacheKey);
			} catch {
				// A hit adds no bytes. Serve it, but fail closed on the next miss.
			}
			leaseReturnedCacheEntry(cacheKey);
		});
		logger.info({ target: logTarget }, "Reference audio served from cache");
		return cached;
	}

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
		YT_DLP_RESULT_TEMPLATE,
		"-o",
		outTemplate,
		// "--" prevents a target from ever being parsed as a yt-dlp flag
		"--",
		target,
	];

	const result = await coordinator.runReserved(
		cacheKey,
		async () => {
			logger.info(
				{ target: logTarget },
				"Downloading reference audio via yt-dlp",
			);
			let stdout: string;
			let stderr: string;
			try {
				({ stdout, stderr } = await runYtDlpProcess(args, cacheKey));
			} catch (err) {
				// Don't surface yt-dlp output to clients or logs — it can echo
				// response content from the fetched host.
				logger.warn(
					{ target: logTarget, err: errSummary(err) },
					"yt-dlp download failed",
				);
				throw new Error("Download failed or source is unsupported");
			}

			let metadata: YoutubeAudioResult;
			try {
				metadata = parseYtDlpDownloadOutput(
					stdout,
					path.join(DOWNLOAD_DIR, `${cacheKey}.mp3`),
				);
			} catch {
				// yt-dlp exits 0 when --match-filter skips the download.
				if (stderr.includes("duration") || stdout.includes("skipping")) {
					throw new Error(
						`Source is longer than ${MAX_DURATION_SECONDS / 60} minutes or could not be downloaded`,
					);
				}
				throw new Error("yt-dlp returned invalid download metadata");
			}
			const { filePath } = metadata;
			if (!fs.existsSync(filePath)) {
				throw new Error("yt-dlp did not produce an audio file");
			}
			if (fs.statSync(filePath).size > MAX_SOURCE_BYTES) {
				throw new Error("Downloaded source exceeds the cache file-size limit");
			}

			let durationSeconds: number;
			try {
				durationSeconds = await probeAudioDuration(filePath);
			} catch (err) {
				logger.warn(
					{ target: logTarget, err: errSummary(err) },
					"Downloaded reference audio could not be measured",
				);
				throw new Error("Downloaded audio is invalid or too long");
			}
			return {
				filePath,
				durationSeconds,
				title: metadata.title,
			};
		},
		(downloaded) => {
			writeCacheMeta(cacheKey, {
				durationSeconds: downloaded.durationSeconds,
				title: downloaded.title,
			});
		},
	);
	await coordinator.serialize(() => leaseReturnedCacheEntry(cacheKey));
	return result;
}

export function serializeDownloadCacheMutation<T>(
	task: () => Promise<T>,
): Promise<T> {
	return runtimeCoordinator().serialize(task);
}

function runYtDlp(
	target: string,
	logTarget: string,
): Promise<YoutubeAudioResult> {
	const cacheKey = downloadCacheKey(target);
	return runtimeCoordinator().runDeduplicated(cacheKey, () =>
		runYtDlpOnce(target, logTarget, cacheKey),
	);
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
