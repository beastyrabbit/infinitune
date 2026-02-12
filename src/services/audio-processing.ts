import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface TrimResult {
	trimmed: boolean;
	originalDuration: number;
	trimmedDuration: number;
}

/**
 * Trims trailing silence from an audio file using ffmpeg.
 * Pass 1: detect silence boundaries via silencedetect.
 * Pass 2: if trailing silence found, stream-copy up to trim point (instant, no re-encode).
 * Non-fatal: if anything fails, the original file is kept and pipeline continues.
 */
export async function trimTrailingSilence(
	audioFilePath: string,
): Promise<TrimResult> {
	const noTrim: TrimResult = {
		trimmed: false,
		originalDuration: 0,
		trimmedDuration: 0,
	};

	try {
		// Pass 1: detect silence boundaries
		const { stderr } = await execFileAsync("ffmpeg", [
			"-i",
			audioFilePath,
			"-af",
			"silencedetect=noise=-50dB:d=2",
			"-f",
			"null",
			"-",
		]);

		// Parse duration from ffmpeg output
		const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
		if (!durationMatch) return noTrim;

		const originalDuration =
			Number.parseInt(durationMatch[1]) * 3600 +
			Number.parseInt(durationMatch[2]) * 60 +
			Number.parseFloat(durationMatch[3]);

		// Parse all silence_start timestamps
		const silenceStarts: number[] = [];
		for (const match of stderr.matchAll(/silence_start:\s*([\d.]+)/g)) {
			silenceStarts.push(Number.parseFloat(match[1]));
		}

		if (silenceStarts.length === 0) {
			return { trimmed: false, originalDuration, trimmedDuration: originalDuration };
		}

		// Only care about trailing silence — the last silence_start should be near the end
		const lastSilenceStart = silenceStarts[silenceStarts.length - 1];
		const trailingGap = originalDuration - lastSilenceStart;

		// Only trim if trailing silence is at least 2 seconds
		if (trailingGap < 3) {
			return { trimmed: false, originalDuration, trimmedDuration: originalDuration };
		}

		// Keep 0.5s buffer after silence_start to preserve reverb tails
		const trimPoint = lastSilenceStart + 1.0;
		if (trimPoint >= originalDuration) {
			return { trimmed: false, originalDuration, trimmedDuration: originalDuration };
		}

		// Pass 2: trim via stream copy (instant, no re-encode)
		const dir = path.dirname(audioFilePath);
		const tmpFile = path.join(dir, `.trimmed-${Date.now()}.mp3`);

		await execFileAsync("ffmpeg", [
			"-i",
			audioFilePath,
			"-t",
			trimPoint.toFixed(3),
			"-c",
			"copy",
			"-y",
			tmpFile,
		]);

		// Atomic rename over original
		fs.renameSync(tmpFile, audioFilePath);

		console.log(
			`  [audio-processing] Trimmed ${audioFilePath}: ${originalDuration.toFixed(1)}s → ${trimPoint.toFixed(1)}s`,
		);

		return {
			trimmed: true,
			originalDuration,
			trimmedDuration: trimPoint,
		};
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		// Check if ffmpeg is simply not installed
		if (msg.includes("ENOENT")) {
			console.warn(
				"  [audio-processing] ffmpeg not found, skipping silence trim",
			);
		} else {
			console.warn(
				`  [audio-processing] Silence trim failed (keeping original): ${msg}`,
			);
		}
		return noTrim;
	}
}
