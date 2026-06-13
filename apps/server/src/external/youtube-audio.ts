import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logger } from "../logger";
import { isPrivateIp } from "../utils/public-http";

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR = path.resolve(
	process.env.REIMAGINE_SOURCES_DIR || "data/reimagine-sources",
);
const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_DURATION_SECONDS = 600;
const MAX_SEARCH_QUERY_LENGTH = 200;

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

function readCachedResult(cacheKey: string): YoutubeAudioResult | null {
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
	const durationSeconds = Number.isFinite(meta?.durationSeconds)
		? (meta?.durationSeconds as number)
		: 180;
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
async function runYtDlp(
	target: string,
	logTarget: string,
): Promise<YoutubeAudioResult> {
	fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
	const cacheKey = downloadCacheKey(target);
	const cached = readCachedResult(cacheKey);
	if (cached) {
		logger.info({ target: logTarget }, "Reference audio served from cache");
		return cached;
	}

	const outTemplate = path.join(DOWNLOAD_DIR, `${cacheKey}.%(ext)s`);
	const args = [
		"--no-playlist",
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
	const [durationRaw, title, filePath] = (line ?? "").split("\t");
	if (!filePath || !fs.existsSync(filePath)) {
		// yt-dlp exits 0 when --match-filter skips the download
		if (stderr.includes("duration") || stdout.includes("skipping")) {
			throw new Error(
				`Source is longer than ${MAX_DURATION_SECONDS / 60} minutes or could not be downloaded`,
			);
		}
		throw new Error("yt-dlp did not produce an audio file");
	}

	const durationSeconds = Number.parseFloat(durationRaw);
	const result: YoutubeAudioResult = {
		filePath,
		durationSeconds: Number.isFinite(durationSeconds)
			? Math.min(durationSeconds, MAX_DURATION_SECONDS)
			: 180,
		title: title?.trim() || "External Source",
	};
	writeCacheMeta(cacheKey, {
		durationSeconds: result.durationSeconds,
		title: result.title,
	});
	return result;
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
