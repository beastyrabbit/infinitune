import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "../logger";
import { isPrivateIp } from "../utils/public-http";

const execFileAsync = promisify(execFile);

const DOWNLOAD_DIR = path.resolve(
	process.env.REIMAGINE_SOURCES_DIR || "data/reimagine-sources",
);
const DOWNLOAD_TIMEOUT_MS = 180_000;
const MAX_DURATION_SECONDS = 600;

export interface YoutubeAudioResult {
	filePath: string;
	durationSeconds: number;
	title: string;
}

/**
 * SSRF guard: only public http(s) hosts may be fetched. Rejects URLs whose
 * hostname resolves to loopback, RFC1918, link-local, or other private
 * ranges, so the downloader can't be pointed at internal services.
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
 * Download the audio track of a YouTube (or other yt-dlp supported) URL as
 * MP3 for use as an ACE cover-task reference. Rejects sources longer than
 * 10 minutes. Files are kept under data/reimagine-sources.
 */
export async function downloadYoutubeAudio(
	url: string,
): Promise<YoutubeAudioResult> {
	await assertPublicHttpUrl(url);

	fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
	const id = createId();
	const outTemplate = path.join(DOWNLOAD_DIR, `${id}.%(ext)s`);

	const args = [
		"--no-playlist",
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
		// "--" prevents a URL from ever being parsed as a yt-dlp flag
		"--",
		url,
	];

	logger.info({ url }, "Downloading reference audio via yt-dlp");
	let stdout: string;
	let stderr: string;
	try {
		({ stdout, stderr } = await execFileAsync("yt-dlp", args, {
			timeout: DOWNLOAD_TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
		}));
	} catch (err) {
		// Don't surface yt-dlp output to clients — it can echo response
		// content from the fetched host. Log it, return a generic error.
		logger.warn({ url, err }, "yt-dlp download failed");
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
	return {
		filePath,
		durationSeconds: Number.isFinite(durationSeconds)
			? Math.min(durationSeconds, MAX_DURATION_SECONDS)
			: 180,
		title: title?.trim() || "External Source",
	};
}
