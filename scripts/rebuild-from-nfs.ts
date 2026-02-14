#!/usr/bin/env tsx
/**
 * Disaster recovery: Rebuild SQLite from NFS generation.log files
 *
 * Usage: pnpm rebuild:nfs
 *
 * Scans MUSIC_STORAGE_PATH/.by-id/ for song folders containing generation.log,
 * then inserts each song into SQLite under a single "Imported Library" playlist.
 * Also copies any cover.png found in NFS folders → data/covers/.
 *
 * Idempotent — safe to run multiple times. Existing songs are skipped.
 * Does NOT require Convex or any cloud services.
 */

import fs from "node:fs"
import path from "node:path"
import { db, schema } from "../api-server/db/index"
import { ensureSchema } from "../api-server/db/migrate"
import { eq } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"

// ─── Paths ───────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..")
const DATA_DIR = path.join(PROJECT_ROOT, "data")
const COVERS_DIR = path.join(DATA_DIR, "covers")

// ─── Types ───────────────────────────────────────────────────────────

interface GenerationLog {
	songId: string
	title: string
	artistName: string
	genre: string
	subGenre: string
	caption: string
	vocalStyle?: string
	coverPrompt?: string
	mood?: string
	energy?: string
	era?: string
	instruments?: string[]
	tags?: string[]
	themes?: string[]
	language?: string
	bpm: number
	keyScale: string
	timeSignature: string
	audioDuration: number
	aceAudioPath: string
	generatedAt: string
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
	console.log("═══════════════════════════════════════════════════════")
	console.log("  Infinitune: Rebuild SQLite from NFS")
	console.log("═══════════════════════════════════════════════════════\n")

	const storagePath = process.env.MUSIC_STORAGE_PATH
	if (!storagePath) {
		console.error("[rebuild] MUSIC_STORAGE_PATH not set. Check .env.local")
		process.exit(1)
	}

	const byIdDir = path.join(storagePath, ".by-id")
	if (!fs.existsSync(byIdDir)) {
		console.error(`[rebuild] Directory not found: ${byIdDir}`)
		process.exit(1)
	}

	// Ensure schema
	ensureSchema()
	fs.mkdirSync(COVERS_DIR, { recursive: true })

	// Create or find the "Imported Library" playlist
	const playlistId = getOrCreateImportPlaylist()

	// Scan .by-id/ directories
	const songDirs = fs.readdirSync(byIdDir)
	console.log(`[rebuild] Found ${songDirs.length} song directories\n`)

	let imported = 0
	let skipped = 0
	let covers = 0
	let errors = 0

	for (const songId of songDirs) {
		const dirPath = path.join(byIdDir, songId)

		// Resolve symlinks
		let resolvedPath: string
		try {
			resolvedPath = fs.realpathSync(dirPath)
		} catch (err) {
			console.warn(`  [rebuild] Cannot resolve symlink ${dirPath}: ${err instanceof Error ? err.message : err}`)
			errors++
			continue
		}

		if (!fs.statSync(resolvedPath).isDirectory()) continue

		const logPath = path.join(resolvedPath, "generation.log")
		if (!fs.existsSync(logPath)) {
			console.warn(`  [rebuild] No generation.log in ${resolvedPath}, skipping`)
			errors++
			continue
		}

		// Check if already in SQLite
		const existing = db.select().from(schema.songs).where(eq(schema.songs.id, songId)).get()
		if (existing) {
			skipped++
			continue
		}

		// Parse generation.log
		let log: GenerationLog
		try {
			log = JSON.parse(fs.readFileSync(logPath, "utf-8"))
		} catch (err) {
			console.warn(`  [rebuild] Failed to parse ${logPath}: ${err instanceof Error ? err.message : err}`)
			errors++
			continue
		}

		// Validate required fields
		if (!log.aceAudioPath) {
			console.warn(`  [rebuild] Missing aceAudioPath in ${logPath}, skipping`)
			errors++
			continue
		}

		// Read lyrics from lyrics.txt if available
		const lyricsPath = path.join(resolvedPath, "lyrics.txt")
		const lyrics = fs.existsSync(lyricsPath) ? fs.readFileSync(lyricsPath, "utf-8") : ""

		// Build audioUrl from songId + aceAudioPath
		const encodedAudioPath = encodeURIComponent(log.aceAudioPath)
		const audioUrl = `/api/autoplayer/audio/${songId}?aceAudioPath=${encodedAudioPath}`

		// Handle cover art
		let coverUrl: string | null = null
		const nfsCoverPath = path.join(resolvedPath, "cover.png")
		if (fs.existsSync(nfsCoverPath)) {
			const coverFilename = `${songId}.png`
			fs.copyFileSync(nfsCoverPath, path.join(COVERS_DIR, coverFilename))
			coverUrl = `/covers/${coverFilename}`
			covers++
		}

		// Determine creation time from generatedAt or file mtime
		let createdAt: number
		if (log.generatedAt) {
			const parsed = new Date(log.generatedAt).getTime()
			if (Number.isNaN(parsed)) {
				console.warn(`  [rebuild] Invalid generatedAt "${log.generatedAt}" for ${songId}, using file mtime`)
				createdAt = fs.statSync(logPath).mtimeMs
			} else {
				createdAt = parsed
			}
		} else {
			createdAt = fs.statSync(logPath).mtimeMs
		}

		db.insert(schema.songs)
			.values({
				id: songId,
				createdAt: Math.round(createdAt),
				playlistId,
				orderIndex: imported,
				title: log.title,
				artistName: log.artistName,
				genre: log.genre,
				subGenre: log.subGenre,
				lyrics,
				caption: log.caption,
				coverPrompt: log.coverPrompt ?? null,
				coverUrl,
				bpm: log.bpm,
				keyScale: log.keyScale,
				timeSignature: log.timeSignature,
				audioDuration: log.audioDuration,
				vocalStyle: log.vocalStyle ?? null,
				mood: log.mood ?? null,
				energy: log.energy ?? null,
				era: log.era ?? null,
				instruments: log.instruments ? JSON.stringify(log.instruments) : null,
				tags: log.tags ? JSON.stringify(log.tags) : null,
				themes: log.themes ? JSON.stringify(log.themes) : null,
				language: log.language ?? null,
				status: "ready",
				audioUrl,
				storagePath: resolvedPath,
				aceAudioPath: log.aceAudioPath,
			})
			.run()
		imported++
	}

	// Update playlist song count (imported + previously existing)
	db.update(schema.playlists)
		.set({ songsGenerated: imported + skipped })
		.where(eq(schema.playlists.id, playlistId))
		.run()

	console.log("\n═══════════════════════════════════════════════════════")
	console.log("  Rebuild complete!")
	console.log(`  Songs:    ${imported} imported, ${skipped} skipped, ${errors} errors`)
	console.log(`  Covers:   ${covers} copied to data/covers/`)
	console.log(`  Playlist: ${playlistId}`)
	console.log("═══════════════════════════════════════════════════════\n")
}

function getOrCreateImportPlaylist(): string {
	// Look for existing "Imported Library" playlist
	const existing = db
		.select()
		.from(schema.playlists)
		.where(eq(schema.playlists.name, "Imported Library"))
		.get()
	if (existing) {
		console.log(`[rebuild] Using existing playlist: ${existing.id}`)
		return existing.id
	}

	const id = createId()
	db.insert(schema.playlists)
		.values({
			id,
			createdAt: Date.now(),
			name: "Imported Library",
			prompt: "Rebuilt from NFS storage",
			llmProvider: "ollama",
			llmModel: "unknown",
			mode: "endless",
			status: "closed",
			songsGenerated: 0,
		})
		.run()

	console.log(`[rebuild] Created playlist: ${id}`)
	return id
}

try {
	main()
} catch (err) {
	console.error("[rebuild] Fatal error:", err)
	process.exit(1)
}
