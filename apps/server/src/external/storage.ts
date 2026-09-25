import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { SongCover } from "@infinitune/shared/types";
import { trimTrailingSilence } from "./audio-processing";
import { getServiceUrls } from "./service-urls";

const ACE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ACE_AUDIO_BYTES = 100 * 1024 * 1024;
/** Longer than any live save holds its pending audio (download deadline plus trimming). */
const PENDING_AUDIO_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_AUDIO_FILE = /^\.audio-.+\.mp3$/;

/** Stream ACE audio to disk with a deadline and a hard size cap. */
export async function downloadAceAudio(
	url: string,
	targetFile: string,
	maxBytes = MAX_ACE_AUDIO_BYTES,
): Promise<void> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(ACE_DOWNLOAD_TIMEOUT_MS),
	});
	if (!response.ok || !response.body) {
		void response.body?.cancel().catch(() => undefined);
		throw new Error(`Failed to download audio: ${response.status}`);
	}
	if (Number(response.headers.get("content-length")) > maxBytes) {
		void response.body.cancel().catch(() => undefined);
		throw new Error("ACE audio download is too large");
	}

	let receivedBytes = 0;
	const sizeGuard = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			receivedBytes += chunk.length;
			callback(
				receivedBytes > maxBytes
					? new Error("ACE audio download is too large")
					: null,
				chunk,
			);
		},
	});
	try {
		await pipeline(
			Readable.fromWeb(response.body as NodeReadableStream),
			sizeGuard,
			fs.createWriteStream(targetFile),
		);
	} catch (error) {
		fs.rmSync(targetFile, { force: true });
		throw error;
	}
}

function resolveLocalAudioPath(aceAudioPath: string): string | null {
	const storagePath = process.env.MUSIC_STORAGE_PATH;
	const aceNasPrefix = process.env.ACE_NAS_PREFIX;
	if (!storagePath || !aceNasPrefix) return null;

	// aceAudioPath is a URL like /v1/audio?path={encoded_path}
	// Extract the raw filesystem path from the query param
	try {
		const url = new URL(aceAudioPath, "http://localhost");
		const rawPath = url.searchParams.get("path");
		if (!rawPath) return null;

		// Replace ACE_NAS_PREFIX with MUSIC_STORAGE_PATH to get local mount path
		if (!rawPath.startsWith(aceNasPrefix)) return null;
		const localPath = rawPath.replace(aceNasPrefix, storagePath);
		return fs.existsSync(localPath) ? localPath : null;
	} catch {
		return null;
	}
}

/** Remove pending audio that a crashed save left in the song folder. */
function removeStalePendingAudio(songDir: string): void {
	const cutoff = Date.now() - PENDING_AUDIO_MAX_AGE_MS;
	for (const name of fs.readdirSync(songDir)) {
		if (!PENDING_AUDIO_FILE.test(name)) continue;
		const file = path.join(songDir, name);
		try {
			if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
		} catch {
			// Another save removed or committed it in the meantime.
		}
	}
}

function linkSongDirById(
	storagePath: string,
	songId: string,
	songDir: string,
): void {
	const byIdDir = path.join(storagePath, ".by-id");
	fs.mkdirSync(byIdDir, { recursive: true });
	const idLink = path.join(byIdDir, songId);
	try {
		if (fs.existsSync(idLink)) fs.unlinkSync(idLink);
		fs.symlinkSync(songDir, idLink);
	} catch {
		fs.writeFileSync(idLink, songDir);
	}
}

function saveSongCover(
	songDir: string,
	cover: SongCover | null | undefined,
	coverPngBase64: string | null | undefined,
): void {
	if (cover?.pngUrl && !cover.pngUrl.startsWith("data:")) {
		const coverFilenames = [
			{ url: cover.pngUrl, output: "cover.png" },
			{ url: cover.webpUrl, output: "cover.webp" },
			{ url: cover.jxlUrl, output: "cover.jxl" },
		];
		for (const entry of coverFilenames) {
			if (!entry.url || entry.url.startsWith("data:")) continue;
			const sourcePath = path.resolve(
				import.meta.dirname,
				"../../../../data/covers",
				path.basename(entry.url),
			);
			if (fs.existsSync(sourcePath)) {
				fs.copyFileSync(sourcePath, path.join(songDir, entry.output));
			}
		}
	} else if (coverPngBase64) {
		const coverBuffer = Buffer.from(coverPngBase64, "base64");
		fs.writeFileSync(path.join(songDir, "cover.png"), coverBuffer);
	}
}

export async function saveSongToNfs(options: {
	songId: string;
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	lyrics: string;
	caption: string;
	vocalStyle?: string;
	coverPrompt?: string;
	mood?: string;
	energy?: string;
	era?: string;
	instruments?: string[];
	tags?: string[];
	themes?: string[];
	language?: string;
	bpm: number;
	keyScale: string;
	timeSignature: string;
	audioDuration: number;
	aceAudioPath: string;
	cover?: SongCover | null;
	coverPngBase64?: string | null;
	/** Checked before any file in the song folder changes. */
	isCancelled?: () => boolean;
}): Promise<{
	storagePath: string;
	audioFile: string;
	effectiveDuration?: number;
} | null> {
	const {
		songId,
		title,
		artistName,
		genre,
		subGenre,
		lyrics,
		caption,
		vocalStyle,
		coverPrompt,
		mood,
		energy,
		era,
		instruments,
		tags,
		themes,
		language,
		bpm,
		keyScale,
		timeSignature,
		audioDuration,
		aceAudioPath,
		cover,
		coverPngBase64,
		isCancelled,
	} = options;

	const storagePath =
		process.env.MUSIC_STORAGE_PATH || "/mnt/truenas/MediaBiB/media/AI-Music";

	const sanitize = (s: string) =>
		s
			.replace(/[<>:"/\\|?*]/g, "_")
			.replace(/[\p{Cc}]/gu, "_")
			.replace(/\s+/g, " ")
			.trim();

	const genreDir = sanitize(genre);
	const subGenreDir = sanitize(subGenre);
	const songFolder = sanitize(`${artistName} - ${title}`);

	const songDir = path.join(storagePath, genreDir, subGenreDir, songFolder);
	fs.mkdirSync(songDir, { recursive: true });
	removeStalePendingAudio(songDir);

	// Prepare the audio under a private name: a replacement worker for the
	// same song may save into this folder while this download is running.
	const audioFile = path.join(songDir, "audio.mp3");
	const pendingAudioFile = path.join(songDir, `.audio-${randomUUID()}.mp3`);
	let trimResult: Awaited<ReturnType<typeof trimTrailingSilence>>;
	try {
		// Try to copy from local NAS mount first (ACE writes to same NAS share)
		const localAudioPath = resolveLocalAudioPath(aceAudioPath);
		if (localAudioPath) {
			fs.copyFileSync(localAudioPath, pendingAudioFile);
		} else {
			// Fall back to HTTP download from ACE if local file isn't found
			const urls = await getServiceUrls();
			const aceUrl = urls.aceStepUrl;
			await downloadAceAudio(`${aceUrl}${aceAudioPath}`, pendingAudioFile);
		}

		// Trim trailing silence from audio
		trimResult = await trimTrailingSilence(pendingAudioFile);
	} catch (error) {
		fs.rmSync(pendingAudioFile, { force: true });
		throw error;
	}

	// From here on everything is synchronous, so a cancellation cannot slip in
	// between this check and the writes that replace the folder's files.
	if (isCancelled?.()) {
		fs.rmSync(pendingAudioFile, { force: true });
		return null;
	}
	fs.renameSync(pendingAudioFile, audioFile);
	linkSongDirById(storagePath, songId, songDir);

	saveSongCover(songDir, cover, coverPngBase64);

	fs.writeFileSync(path.join(songDir, "lyrics.txt"), lyrics);

	const log = {
		songId,
		title,
		artistName,
		genre,
		subGenre,
		caption,
		vocalStyle,
		coverPrompt,
		mood,
		energy,
		era,
		instruments,
		tags,
		themes,
		language,
		bpm,
		keyScale,
		timeSignature,
		audioDuration,
		aceAudioPath,
		generatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(
		path.join(songDir, "generation.log"),
		JSON.stringify(log, null, 2),
	);

	return {
		storagePath: songDir,
		audioFile,
		effectiveDuration: trimResult.trimmed
			? trimResult.trimmedDuration
			: undefined,
	};
}
