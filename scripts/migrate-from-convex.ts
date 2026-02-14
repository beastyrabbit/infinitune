#!/usr/bin/env tsx
/**
 * Migration script: Convex cloud → SQLite + NFS covers
 *
 * Usage: pnpm migrate:convex
 *
 * 1. Runs `npx convex export --include-file-storage --path <zip>` to dump the cloud DB
 * 2. Imports playlists, songs, and settings into the local SQLite database
 * 3. Extracts cover images from the Convex export → data/covers/ + NFS song folders
 *
 * Idempotent — safe to run multiple times. Existing records are skipped.
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import readline from "node:readline"
import { db, schema } from "../api-server/db/index"
import { ensureSchema } from "../api-server/db/migrate"
import { eq } from "drizzle-orm"

// ─── Paths ───────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..")
const DATA_DIR = path.join(PROJECT_ROOT, "data")
const COVERS_DIR = path.join(DATA_DIR, "covers")
const EXPORT_ZIP = path.join(PROJECT_ROOT, "convex-export.zip")
const EXPORT_DIR = path.join(PROJECT_ROOT, "convex-export")

// ─── Helpers ─────────────────────────────────────────────────────────

function ask(question: string): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

/** Parse a JSONL file into an array of objects, skipping malformed lines */
function parseJsonl<T = Record<string, unknown>>(filePath: string): T[] {
	if (!fs.existsSync(filePath)) return []
	const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter((line) => line.trim())
	const results: T[] = []
	for (let i = 0; i < lines.length; i++) {
		try {
			results.push(JSON.parse(lines[i]) as T)
		} catch (err) {
			console.warn(`[migrate] Skipping malformed JSON at ${filePath}:${i + 1}: ${err instanceof Error ? err.message : err}`)
		}
	}
	return results
}

/** Find a JSONL file for a table — handles both flat and nested export formats */
function findJsonl(exportDir: string, tableName: string): string | null {
	// Format A: {table}.jsonl at root
	const flat = path.join(exportDir, `${tableName}.jsonl`)
	if (fs.existsSync(flat)) return flat

	// Format B: {table}/documents.jsonl
	const nested = path.join(exportDir, tableName, "documents.jsonl")
	if (fs.existsSync(nested)) return nested

	return null
}

/** Find the storage directory in the export */
function findStorageDir(exportDir: string): string | null {
	const dir = path.join(exportDir, "_storage")
	return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null
}

/** Resolve NFS song folder from storagePath or .by-id link */
function resolveNfsSongDir(storagePath: string | null, songId: string): string | null {
	// Try storagePath first (direct path to song folder)
	if (storagePath && fs.existsSync(storagePath)) return storagePath

	// Try .by-id symlink
	const musicStorage = process.env.MUSIC_STORAGE_PATH
	if (!musicStorage) return null
	const byIdLink = path.join(musicStorage, ".by-id", songId)
	if (fs.existsSync(byIdLink)) {
		const resolved = fs.realpathSync(byIdLink)
		if (fs.existsSync(resolved)) return resolved
	}
	return null
}

// ─── Storage ID → File Blob Mapping ─────────────────────────────────

interface StorageEntry {
	_id: string
	_creationTime: number
	sha256?: string
}

/** Build a map of storageId → file path (lazy — reads on demand, not all into RAM) */
function buildStoragePathMap(exportDir: string): Map<string, string> {
	const map = new Map<string, string>()
	const storageDir = findStorageDir(exportDir)
	if (!storageDir) return map

	// Parse _storage.jsonl for metadata
	const storageJsonl = findJsonl(exportDir, "_storage")
	const entries: StorageEntry[] = storageJsonl ? parseJsonl(storageJsonl) : []

	for (const entry of entries) {
		if (!entry._id) continue

		const candidates = [
			path.join(storageDir, entry._id),
			entry.sha256 ? path.join(storageDir, entry.sha256) : null,
		].filter(Boolean) as string[]

		for (const candidate of candidates) {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
				map.set(entry._id, candidate)
				break
			}
		}
	}

	// Also scan storage dir for any files not in the JSONL (belt & suspenders)
	for (const file of fs.readdirSync(storageDir)) {
		const filePath = path.join(storageDir, file)
		if (fs.statSync(filePath).isFile() && !map.has(file)) {
			map.set(file, filePath)
		}
	}

	return map
}

// ─── Export from Convex ──────────────────────────────────────────────

async function exportFromConvex(): Promise<void> {
	if (fs.existsSync(EXPORT_ZIP)) {
		const reuse = await ask(`Found existing ${EXPORT_ZIP}. Reuse it? [Y/n] `)
		if (reuse.toLowerCase() !== "n") return
	}

	console.log("\n[migrate] Exporting from Convex cloud (this may take a minute)...")
	try {
		execFileSync("npx", ["convex", "export", "--include-file-storage", "--path", EXPORT_ZIP], {
			cwd: PROJECT_ROOT,
			stdio: "inherit",
		})
	} catch (err) {
		console.error("[migrate] Failed to run `npx convex export`.")
		console.error("  Error:", err instanceof Error ? err.message : err)
		console.error("  Common fix: npx convex login")
		process.exit(1)
	}
}

// ─── Unzip Export ────────────────────────────────────────────────────

function unzipExport(): void {
	if (fs.existsSync(EXPORT_DIR)) {
		fs.rmSync(EXPORT_DIR, { recursive: true })
	}
	fs.mkdirSync(EXPORT_DIR, { recursive: true })

	console.log("[migrate] Unzipping export...")
	try {
		execFileSync("unzip", ["-q", "-o", EXPORT_ZIP, "-d", EXPORT_DIR], {
			cwd: PROJECT_ROOT,
			stdio: "inherit",
		})
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		if (msg.includes("ENOENT")) {
			console.error("[migrate] `unzip` command not found. Install it with: sudo apt install unzip (or brew install unzip)")
		} else {
			console.error(`[migrate] Failed to unzip ${EXPORT_ZIP}: ${msg}`)
		}
		process.exit(1)
	}
}

// ─── Import Playlists ────────────────────────────────────────────────

interface ConvexPlaylist {
	_id: string
	_creationTime: number
	name: string
	prompt: string
	llmProvider: string
	llmModel: string
	mode?: string
	status: string
	songsGenerated: number
	playlistKey?: string
	lyricsLanguage?: string
	targetBpm?: number
	targetKey?: string
	timeSignature?: string
	audioDuration?: number
	inferenceSteps?: number
	lmTemperature?: number
	lmCfgScale?: number
	inferMethod?: string
	currentOrderIndex?: number
	lastSeenAt?: number
	promptEpoch?: number
	steerHistory?: Array<{ epoch: number; direction: string; at: number }>
}

function importPlaylists(exportDir: string): { imported: number; skipped: number } {
	const jsonlPath = findJsonl(exportDir, "playlists")
	if (!jsonlPath) {
		console.log("[migrate] No playlists.jsonl found — skipping")
		return { imported: 0, skipped: 0 }
	}

	const rows = parseJsonl<ConvexPlaylist>(jsonlPath)
	let imported = 0
	let skipped = 0

	for (const row of rows) {
		const existing = db.select().from(schema.playlists).where(eq(schema.playlists.id, row._id)).get()
		if (existing) {
			skipped++
			continue
		}

		try {
			db.insert(schema.playlists)
				.values({
					id: row._id,
					createdAt: row._creationTime,
					name: row.name,
					prompt: row.prompt,
					llmProvider: row.llmProvider,
					llmModel: row.llmModel,
					mode: row.mode ?? "endless",
					status: row.status,
					songsGenerated: row.songsGenerated,
					playlistKey: row.playlistKey ?? null,
					lyricsLanguage: row.lyricsLanguage ?? null,
					targetBpm: row.targetBpm ?? null,
					targetKey: row.targetKey ?? null,
					timeSignature: row.timeSignature ?? null,
					audioDuration: row.audioDuration ?? null,
					inferenceSteps: row.inferenceSteps ?? null,
					lmTemperature: row.lmTemperature ?? null,
					lmCfgScale: row.lmCfgScale ?? null,
					inferMethod: row.inferMethod ?? null,
					currentOrderIndex: row.currentOrderIndex ?? null,
					lastSeenAt: row.lastSeenAt ?? null,
					promptEpoch: row.promptEpoch ?? 0,
					steerHistory: row.steerHistory ? JSON.stringify(row.steerHistory) : null,
				})
				.run()
			imported++
		} catch (err) {
			console.error(`[migrate] Failed to import playlist ${row._id}: ${err instanceof Error ? err.message : err}`)
		}
	}

	return { imported, skipped }
}

// ─── Import Songs ────────────────────────────────────────────────────

interface ConvexSong {
	_id: string
	_creationTime: number
	playlistId: string
	orderIndex: number
	title?: string
	artistName?: string
	genre?: string
	subGenre?: string
	lyrics?: string
	caption?: string
	coverPrompt?: string
	coverUrl?: string
	coverStorageId?: string
	bpm?: number
	keyScale?: string
	timeSignature?: string
	audioDuration?: number
	vocalStyle?: string
	mood?: string
	energy?: string
	era?: string
	instruments?: string[]
	tags?: string[]
	themes?: string[]
	language?: string
	description?: string
	status: string
	aceTaskId?: string
	aceSubmittedAt?: number
	audioUrl?: string
	storagePath?: string
	aceAudioPath?: string
	errorMessage?: string
	retryCount?: number
	erroredAtStatus?: string
	cancelledAtStatus?: string
	generationStartedAt?: number
	generationCompletedAt?: number
	isInterrupt?: boolean
	interruptPrompt?: string
	llmProvider?: string
	llmModel?: string
	promptEpoch?: number
	userRating?: "up" | "down"
	playDurationMs?: number
	listenCount?: number
	metadataProcessingMs?: number
	coverProcessingMs?: number
	audioProcessingMs?: number
	personaExtract?: string
}

function importSongs(
	exportDir: string,
	storagePathMap: Map<string, string>,
): { imported: number; skipped: number; covers: number } {
	const jsonlPath = findJsonl(exportDir, "songs")
	if (!jsonlPath) {
		console.log("[migrate] No songs.jsonl found — skipping")
		return { imported: 0, skipped: 0, covers: 0 }
	}

	fs.mkdirSync(COVERS_DIR, { recursive: true })

	const rows = parseJsonl<ConvexSong>(jsonlPath)
	let imported = 0
	let skipped = 0
	let covers = 0

	for (const row of rows) {
		const existing = db.select().from(schema.songs).where(eq(schema.songs.id, row._id)).get()
		if (existing) {
			skipped++
			continue
		}

		// Resolve cover image from Convex file storage
		let coverUrl = row.coverUrl ?? null
		if (row.coverStorageId && storagePathMap.has(row.coverStorageId)) {
			const coverBuffer = fs.readFileSync(storagePathMap.get(row.coverStorageId)!)

			// Save to data/covers/{songId}.png (served by API)
			const coverFilename = `${row._id}.png`
			const coverPath = path.join(COVERS_DIR, coverFilename)
			fs.writeFileSync(coverPath, coverBuffer)
			coverUrl = `/covers/${coverFilename}`

			// Save to NFS song folder if it exists
			const nfsDir = resolveNfsSongDir(row.storagePath ?? null, row._id)
			if (nfsDir) {
				const nfsCoverPath = path.join(nfsDir, "cover.png")
				if (!fs.existsSync(nfsCoverPath)) {
					fs.writeFileSync(nfsCoverPath, coverBuffer)
				}
			}
			covers++
		}

		try {
			db.insert(schema.songs)
				.values({
					id: row._id,
					createdAt: row._creationTime,
					playlistId: row.playlistId,
					orderIndex: row.orderIndex,
					title: row.title ?? null,
					artistName: row.artistName ?? null,
					genre: row.genre ?? null,
					subGenre: row.subGenre ?? null,
					lyrics: row.lyrics ?? null,
					caption: row.caption ?? null,
					coverPrompt: row.coverPrompt ?? null,
					coverUrl,
					bpm: row.bpm ?? null,
					keyScale: row.keyScale ?? null,
					timeSignature: row.timeSignature ?? null,
					audioDuration: row.audioDuration ?? null,
					vocalStyle: row.vocalStyle ?? null,
					mood: row.mood ?? null,
					energy: row.energy ?? null,
					era: row.era ?? null,
					instruments: row.instruments ? JSON.stringify(row.instruments) : null,
					tags: row.tags ? JSON.stringify(row.tags) : null,
					themes: row.themes ? JSON.stringify(row.themes) : null,
					language: row.language ?? null,
					description: row.description ?? null,
					status: row.status,
					aceTaskId: row.aceTaskId ?? null,
					aceSubmittedAt: row.aceSubmittedAt ?? null,
					audioUrl: row.audioUrl ?? null,
					storagePath: row.storagePath ?? null,
					aceAudioPath: row.aceAudioPath ?? null,
					errorMessage: row.errorMessage ?? null,
					retryCount: row.retryCount ?? 0,
					erroredAtStatus: row.erroredAtStatus ?? null,
					cancelledAtStatus: row.cancelledAtStatus ?? null,
					generationStartedAt: row.generationStartedAt ?? null,
					generationCompletedAt: row.generationCompletedAt ?? null,
					isInterrupt: row.isInterrupt ?? null,
					interruptPrompt: row.interruptPrompt ?? null,
					llmProvider: row.llmProvider ?? null,
					llmModel: row.llmModel ?? null,
					promptEpoch: row.promptEpoch ?? null,
					userRating: row.userRating ?? null,
					playDurationMs: row.playDurationMs ?? null,
					listenCount: row.listenCount ?? 0,
					metadataProcessingMs: row.metadataProcessingMs ?? null,
					coverProcessingMs: row.coverProcessingMs ?? null,
					audioProcessingMs: row.audioProcessingMs ?? null,
					personaExtract: row.personaExtract ?? null,
				})
				.run()
			imported++
		} catch (err) {
			console.error(`[migrate] Failed to import song ${row._id}: ${err instanceof Error ? err.message : err}`)
		}
	}

	return { imported, skipped, covers }
}

// ─── Import Settings ─────────────────────────────────────────────────

interface ConvexSetting {
	_id: string
	_creationTime: number
	key: string
	value: string
}

function importSettings(exportDir: string): { imported: number; skipped: number } {
	const jsonlPath = findJsonl(exportDir, "settings")
	if (!jsonlPath) {
		console.log("[migrate] No settings.jsonl found — skipping")
		return { imported: 0, skipped: 0 }
	}

	const rows = parseJsonl<ConvexSetting>(jsonlPath)
	let imported = 0
	let skipped = 0

	for (const row of rows) {
		const existing = db
			.select()
			.from(schema.settings)
			.where(eq(schema.settings.key, row.key))
			.get()
		if (existing) {
			skipped++
			continue
		}

		try {
			db.insert(schema.settings)
				.values({
					id: row._id,
					createdAt: row._creationTime,
					key: row.key,
					value: row.value,
				})
				.run()
			imported++
		} catch (err) {
			console.error(`[migrate] Failed to import setting ${row.key}: ${err instanceof Error ? err.message : err}`)
		}
	}

	return { imported, skipped }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
	console.log("═══════════════════════════════════════════════════════")
	console.log("  Infinitune: Convex → SQLite Migration")
	console.log("═══════════════════════════════════════════════════════\n")

	// Step 1: Export from Convex
	await exportFromConvex()

	// Step 2: Unzip
	unzipExport()

	// Step 3: Ensure SQLite schema
	ensureSchema()

	// Step 4: Build storage path map (lazy — reads files on demand)
	console.log("[migrate] Indexing file storage...")
	const storagePathMap = buildStoragePathMap(EXPORT_DIR)
	console.log(`[migrate] Found ${storagePathMap.size} storage files`)

	// Step 5: Import data
	console.log("\n[migrate] Importing playlists...")
	const playlists = importPlaylists(EXPORT_DIR)
	console.log(`  → ${playlists.imported} imported, ${playlists.skipped} skipped`)

	console.log("[migrate] Importing songs...")
	const songs = importSongs(EXPORT_DIR, storagePathMap)
	console.log(`  → ${songs.imported} imported, ${songs.skipped} skipped, ${songs.covers} covers saved`)

	console.log("[migrate] Importing settings...")
	const settings = importSettings(EXPORT_DIR)
	console.log(`  → ${settings.imported} imported, ${settings.skipped} skipped`)

	// Step 6: Cleanup
	console.log("\n[migrate] Cleaning up temporary files...")
	fs.rmSync(EXPORT_DIR, { recursive: true })

	console.log("\n═══════════════════════════════════════════════════════")
	console.log("  Migration complete!")
	console.log(`  Playlists: ${playlists.imported} imported, ${playlists.skipped} skipped`)
	console.log(`  Songs:     ${songs.imported} imported, ${songs.skipped} skipped`)
	console.log(`  Covers:    ${songs.covers} saved to data/covers/ + NFS`)
	console.log(`  Settings:  ${settings.imported} imported, ${settings.skipped} skipped`)
	console.log(`  Note:      ${EXPORT_ZIP} retained for re-runs. Delete when done.`)
	console.log("═══════════════════════════════════════════════════════\n")
}

main().catch((err) => {
	console.error("[migrate] Fatal error:", err)
	process.exit(1)
})
