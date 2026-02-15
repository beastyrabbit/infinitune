#!/usr/bin/env tsx
/**
 * Write ID3v2 tags to all MP3 files on NFS using metadata from SQLite.
 *
 * Usage: pnpm tag:mp3s
 *
 * Embeds: title, artist, album (playlist name), genre, BPM, year,
 * track number, lyrics, comment (caption), mood, cover art.
 *
 * Uses ffmpeg to write tags in-place (creates temp file, replaces original).
 * Idempotent — safe to run multiple times (overwrites existing tags).
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { db, schema } from "../api-server/db/index"
import { inArray } from "drizzle-orm"

const COVERS_DIR = path.resolve(import.meta.dirname, "../data/covers")

interface SongRow {
	id: string
	title: string | null
	artistName: string | null
	genre: string | null
	subGenre: string | null
	bpm: number | null
	lyrics: string | null
	caption: string | null
	mood: string | null
	energy: string | null
	era: string | null
	coverUrl: string | null
	storagePath: string | null
	orderIndex: number
	createdAt: number
	playlistId: string
}

function getPlaylistNames(): Map<string, string> {
	const rows = db.select({ id: schema.playlists.id, name: schema.playlists.name }).from(schema.playlists).all()
	return new Map(rows.map((r) => [r.id, r.name]))
}

function resolveAudioPath(storagePath: string | null, songId: string): string | null {
	if (storagePath) {
		const mp3 = path.join(storagePath, "audio.mp3")
		if (fs.existsSync(mp3)) return mp3
	}

	const musicStorage = process.env.MUSIC_STORAGE_PATH
	if (!musicStorage) return null
	const byIdMp3 = path.join(musicStorage, ".by-id", songId, "audio.mp3")
	if (fs.existsSync(byIdMp3)) return byIdMp3

	return null
}

function resolveCoverPath(coverUrl: string | null, songId: string): string | null {
	// Local cover in data/covers/
	if (coverUrl?.startsWith("/covers/")) {
		const localPath = path.join(COVERS_DIR, path.basename(coverUrl))
		if (fs.existsSync(localPath)) return localPath
	}

	// NFS cover
	const musicStorage = process.env.MUSIC_STORAGE_PATH
	if (musicStorage) {
		const nfsCover = path.join(musicStorage, ".by-id", songId, "cover.png")
		if (fs.existsSync(nfsCover)) return nfsCover
	}

	return null
}

export function tagMp3(
	audioPath: string,
	meta: {
		title: string
		artist: string
		album: string
		genre: string
		subGenre: string | null
		bpm: number | null
		year: string
		trackNumber: number
		lyrics: string | null
		comment: string | null
		mood: string | null
		energy: string | null
		coverPath: string | null
	},
): void {
	const tmpPath = `${audioPath}.tagged.mp3`

	const args: string[] = ["-y", "-i", audioPath]

	// Attach cover art if available
	if (meta.coverPath) {
		args.push("-i", meta.coverPath)
		args.push("-map", "0:a", "-map", "1:v")
		args.push("-c:v", "png")
		args.push("-metadata:s:v", "title=Album cover")
		args.push("-metadata:s:v", "comment=Cover (front)")
		args.push("-disposition:v", "attached_pic")
	} else {
		args.push("-map", "0:a")
	}

	args.push("-c:a", "copy") // Don't re-encode audio
	args.push("-id3v2_version", "3") // ID3v2.3 for max compatibility

	// Metadata
	args.push("-metadata", `title=${meta.title}`)
	args.push("-metadata", `artist=${meta.artist}`)
	args.push("-metadata", `album_artist=${meta.artist}`)
	args.push("-metadata", `album=${meta.album}`)
	args.push("-metadata", `genre=${meta.subGenre ? `${meta.genre} / ${meta.subGenre}` : meta.genre}`)
	args.push("-metadata", `date=${meta.year}`)
	args.push("-metadata", `track=${meta.trackNumber}`)

	if (meta.bpm) args.push("-metadata", `TBPM=${Math.round(meta.bpm)}`)
	if (meta.comment) args.push("-metadata", `comment=${meta.comment}`)
	if (meta.mood) args.push("-metadata", `mood=${meta.mood}`)
	if (meta.energy) args.push("-metadata", `TXXX=energy=${meta.energy}`)

	// Lyrics as unsynchronized lyrics tag
	if (meta.lyrics) args.push("-metadata", `lyrics-eng=${meta.lyrics}`)

	args.push(tmpPath)

	execFileSync("ffmpeg", args, { stdio: "pipe" })
	fs.renameSync(tmpPath, audioPath)
}

function main() {
	console.log("═══════════════════════════════════════════════════════")
	console.log("  Infinitune: Write ID3 Tags to MP3s")
	console.log("═══════════════════════════════════════════════════════\n")

	const playlistNames = getPlaylistNames()

	const songs = db
		.select()
		.from(schema.songs)
		.where(inArray(schema.songs.status, ["ready", "played"]))
		.all() as SongRow[]

	console.log(`[tag] Found ${songs.length} songs to tag\n`)

	let tagged = 0
	let skipped = 0
	let errors = 0

	for (const song of songs) {
		const audioPath = resolveAudioPath(song.storagePath, song.id)
		if (!audioPath) {
			skipped++
			continue
		}

		const coverPath = resolveCoverPath(song.coverUrl, song.id)
		const album = playlistNames.get(song.playlistId) ?? "Infinitune"
		const year = new Date(song.createdAt).getFullYear().toString()

		try {
			tagMp3(audioPath, {
				title: song.title ?? "Untitled",
				artist: song.artistName ?? "Infinitune",
				album,
				genre: song.genre ?? "Electronic",
				subGenre: song.subGenre,
				bpm: song.bpm,
				year,
				trackNumber: Math.floor(song.orderIndex) + 1,
				lyrics: song.lyrics,
				comment: song.caption,
				mood: song.mood,
				energy: song.energy,
				coverPath,
			})
			tagged++
			if (tagged % 25 === 0) console.log(`  [tag] Progress: ${tagged}/${songs.length}`)
		} catch (err) {
			console.error(`  [tag] Failed to tag ${song.id} (${song.title}): ${err instanceof Error ? err.message : err}`)
			// Clean up temp file if it exists
			const tmpPath = `${audioPath}.tagged.mp3`
			if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
			errors++
		}
	}

	console.log("\n═══════════════════════════════════════════════════════")
	console.log("  Tagging complete!")
	console.log(`  Tagged:   ${tagged}`)
	console.log(`  Skipped:  ${skipped} (no audio file found)`)
	console.log(`  Errors:   ${errors}`)
	console.log("═══════════════════════════════════════════════════════\n")
}

// Only run when executed directly (not when imported by worker)
const isDirectRun = process.argv[1]?.includes("tag-mp3s")
if (isDirectRun) {
	try {
		main()
	} catch (err) {
		console.error("[tag] Fatal error:", err)
		process.exit(1)
	}
}
