import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function tagMp3(
	audioPath: string,
	meta: {
		title: string;
		artist: string;
		album: string;
		genre: string;
		subGenre: string | null;
		bpm: number | null;
		year: string;
		trackNumber: number;
		lyrics: string | null;
		comment: string | null;
		mood: string | null;
		energy: string | null;
		coverPath: string | null;
	},
): void {
	const tmpPath = `${audioPath}.tagged.mp3`;

	const args: string[] = ["-y", "-i", audioPath];

	// Attach cover art if available
	if (meta.coverPath) {
		args.push("-i", meta.coverPath);
		args.push("-map", "0:a", "-map", "1:v");
		args.push("-c:v", "png");
		args.push("-metadata:s:v", "title=Album cover");
		args.push("-metadata:s:v", "comment=Cover (front)");
		args.push("-disposition:v", "attached_pic");
	} else {
		args.push("-map", "0:a");
	}

	args.push("-c:a", "copy"); // Don't re-encode audio
	args.push("-id3v2_version", "3"); // ID3v2.3 for max compatibility

	// Metadata
	args.push("-metadata", `title=${meta.title}`);
	args.push("-metadata", `artist=${meta.artist}`);
	args.push("-metadata", `album_artist=${meta.artist}`);
	args.push("-metadata", `album=${meta.album}`);
	args.push(
		"-metadata",
		`genre=${meta.subGenre ? `${meta.genre} / ${meta.subGenre}` : meta.genre}`,
	);
	args.push("-metadata", `date=${meta.year}`);
	args.push("-metadata", `track=${meta.trackNumber}`);

	if (meta.bpm) args.push("-metadata", `TBPM=${Math.round(meta.bpm)}`);
	if (meta.comment) args.push("-metadata", `comment=${meta.comment}`);
	if (meta.mood) args.push("-metadata", `mood=${meta.mood}`);
	if (meta.energy) args.push("-metadata", `TXXX=energy=${meta.energy}`);

	// Lyrics as unsynchronized lyrics tag
	if (meta.lyrics) args.push("-metadata", `lyrics-eng=${meta.lyrics}`);

	args.push(tmpPath);

	try {
		execFileSync("ffmpeg", args, { stdio: "pipe" });
		fs.renameSync(tmpPath, audioPath);
	} catch (err) {
		// Clean up temp file on failure
		if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
		throw err;
	}
}
