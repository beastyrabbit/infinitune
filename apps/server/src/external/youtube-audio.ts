import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "../logger";

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
 * Download the audio track of a YouTube (or other yt-dlp supported) URL as
 * MP3 for use as an ACE cover-task reference. Rejects sources longer than
 * 10 minutes. Files are kept under data/reimagine-sources.
 */
export async function downloadYoutubeAudio(
	url: string,
): Promise<YoutubeAudioResult> {
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
		url,
	];

	logger.info({ url }, "Downloading reference audio via yt-dlp");
	const { stdout, stderr } = await execFileAsync("yt-dlp", args, {
		timeout: DOWNLOAD_TIMEOUT_MS,
		maxBuffer: 4 * 1024 * 1024,
	});

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
