import * as fs from "node:fs";
import * as path from "node:path";
import type { SongCover } from "@infinitune/shared/types";
import { getServiceUrls } from "@/lib/server-settings";
import { trimTrailingSilence } from "./audio-processing";

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
		// e.g. /mnt/ai-music/tmpdir/api_audio/... → /mnt/truenas/MediaBiB/media/AI-Music/tmpdir/api_audio/...
		if (!rawPath.startsWith(aceNasPrefix)) return null;
		const localPath = rawPath.replace(aceNasPrefix, storagePath);
		return fs.existsSync(localPath) ? localPath : null;
	} catch {
		return null;
	}
}

function writeDataUrlFile(dataUrl: string, outputPath: string): void {
	const base64 = dataUrl.split(",", 2)[1];
	if (!base64) return;
	fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
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
}): Promise<{
	storagePath: string;
	audioFile: string;
	effectiveDuration?: number;
}> {
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

	const byIdDir = path.join(storagePath, ".by-id");
	fs.mkdirSync(byIdDir, { recursive: true });
	const idLink = path.join(byIdDir, songId);
	try {
		if (fs.existsSync(idLink)) fs.unlinkSync(idLink);
		fs.symlinkSync(songDir, idLink);
	} catch {
		fs.writeFileSync(idLink, songDir);
	}

	// Try to copy from local NAS mount first (ACE writes to same NAS share)
	const localAudioPath = resolveLocalAudioPath(aceAudioPath);
	const audioFile = path.join(songDir, "audio.mp3");

	if (localAudioPath) {
		fs.copyFileSync(localAudioPath, audioFile);
	} else {
		// Fall back to HTTP download from ACE if local file isn't found (e.g., NAS unmounted)
		const urls = await getServiceUrls();
		const aceUrl = urls.aceStepUrl;
		const audioUrl = `${aceUrl}${aceAudioPath}`;
		const audioResponse = await fetch(audioUrl);
		if (!audioResponse.ok) {
			throw new Error(`Failed to download audio: ${audioResponse.status}`);
		}
		const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
		fs.writeFileSync(audioFile, audioBuffer);
	}

	// Trim trailing silence from audio
	const trimResult = await trimTrailingSilence(audioFile);

	if (cover?.pngUrl) {
		const coverEntries = [
			{ url: cover.pngUrl, output: "cover.png" },
			{ url: cover.webpUrl, output: "cover.webp" },
			{ url: cover.jxlUrl, output: "cover.jxl" },
		];
		for (const entry of coverEntries) {
			if (!entry.url) continue;
			if (entry.url.startsWith("data:")) {
				writeDataUrlFile(entry.url, path.join(songDir, entry.output));
			}
		}
	}

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
