import { Hono } from "hono"
import { eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, sqlite } from "../db/index"
import { songs, playlists } from "../db/schema"
import { songToWire } from "../wire"
import { publishEvent, publishWork } from "../rabbit"
import { saveCover } from "../covers"
import { ACTIVE_STATUSES, TRANSIENT_STATUSES } from "../types"

const ACTIVE_PROCESSING_STATUSES = [
	"generating_metadata",
	"submitting_to_ace",
	"generating_audio",
	"saving",
]

const app = new Hono()

// Metadata fields that are stored as plain text columns
const METADATA_SCALAR_FIELDS = [
	"title",
	"artistName",
	"genre",
	"subGenre",
	"lyrics",
	"caption",
	"coverPrompt",
	"bpm",
	"keyScale",
	"timeSignature",
	"audioDuration",
	"vocalStyle",
	"mood",
	"energy",
	"era",
	"language",
	"description",
] as const

// Metadata fields stored as JSON text columns
const METADATA_JSON_FIELDS = ["instruments", "tags", "themes"] as const

// Helper: publish song event
async function emitSongEvent(
	playlistId: string,
	type: string,
	songId?: string,
) {
	await publishEvent(`songs.${playlistId}`, { type, songId })
}

/** Build a patch object from request body, extracting allowed scalar and JSON fields */
function buildMetadataPatch(
	body: Record<string, unknown>,
	extraScalarFields: readonly string[] = [],
): Record<string, unknown> {
	const patch: Record<string, unknown> = {}
	for (const key of [...METADATA_SCALAR_FIELDS, ...extraScalarFields]) {
		if (body[key] !== undefined) patch[key] = body[key]
	}
	for (const key of METADATA_JSON_FIELDS) {
		if (body[key] !== undefined)
			patch[key] = body[key] ? JSON.stringify(body[key]) : null
	}
	return patch
}

/** Update a song, re-fetch it, emit event, and return the row. */
async function updateAndEmit(
	id: string,
	patch: Record<string, unknown>,
	eventType = "updated",
): Promise<void> {
	await db.update(songs).set(patch).where(eq(songs.id, id))
	const [row] = await db.select().from(songs).where(eq(songs.id, id))
	if (row) await emitSongEvent(row.playlistId, eventType, id)
}

// ─── Queries ────────────────────────────────────────────────────────

// GET /api/songs — list all songs (with metadata)
app.get("/", async (c) => {
	const rows = await db.select().from(songs)
	const withMetadata = rows.filter((s) => s.title)
	const sorted = withMetadata.sort((a, b) => b.createdAt - a.createdAt)
	return c.json(sorted.map(songToWire))
})

// Shared handler for fetching songs by playlist, ordered by orderIndex
async function songsByPlaylist(playlistId: string) {
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))
	return rows.sort((a, b) => a.orderIndex - b.orderIndex).map(songToWire)
}

// GET /api/songs/by-playlist/:playlistId — list songs by playlist (ordered)
app.get("/by-playlist/:playlistId", async (c) => {
	return c.json(await songsByPlaylist(c.req.param("playlistId")))
})

// GET /api/songs/queue/:playlistId — alias for by-playlist (same data, kept for client compatibility)
app.get("/queue/:playlistId", async (c) => {
	return c.json(await songsByPlaylist(c.req.param("playlistId")))
})

// GET /api/songs/next-order-index/:playlistId
app.get("/next-order-index/:playlistId", async (c) => {
	const playlistId = c.req.param("playlistId")
	const rows = await db
		.select({ orderIndex: songs.orderIndex })
		.from(songs)
		.where(eq(songs.playlistId, playlistId))
	if (rows.length === 0) return c.json(1)
	const maxOrder = Math.max(...rows.map((s) => s.orderIndex))
	return c.json(Math.ceil(maxOrder) + 1)
})

// GET /api/songs/in-audio-pipeline — songs in audio pipeline statuses
app.get("/in-audio-pipeline", async (c) => {
	const rows = await db
		.select()
		.from(songs)
		.where(
			inArray(songs.status, [
				"submitting_to_ace",
				"generating_audio",
				"saving",
			]),
		)
	return c.json(rows.map(songToWire))
})

// GET /api/songs/needs-persona — songs with rating but no persona extract
app.get("/needs-persona", async (c) => {
	const rows = await db
		.select()
		.from(songs)
		.where(isNotNull(songs.userRating))
	const needsPersona = rows
		.filter((s) => !s.personaExtract && s.title)
		.slice(0, 20)
		.map((s) => ({
			_id: s.id,
			title: s.title!,
			artistName: s.artistName,
			genre: s.genre,
			subGenre: s.subGenre,
			mood: s.mood,
			energy: s.energy,
			era: s.era,
			vocalStyle: s.vocalStyle,
			instruments: s.instruments ? JSON.parse(s.instruments) : undefined,
			themes: s.themes ? JSON.parse(s.themes) : undefined,
			description: s.description,
			lyrics: s.lyrics,
		}))
	return c.json(needsPersona)
})

// GET /api/songs/work-queue/:playlistId — worker work queue (complex aggregation)
app.get("/work-queue/:playlistId", async (c) => {
	const playlistId = c.req.param("playlistId")

	const allSongs = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))

	const [playlist] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.id, playlistId))

	const pending = allSongs
		.filter((s) => s.status === "pending")
		.sort((a, b) => a.orderIndex - b.orderIndex)
	const metadataReady = allSongs
		.filter((s) => s.status === "metadata_ready")
		.sort((a, b) => a.orderIndex - b.orderIndex)
	const needsCover = allSongs.filter(
		(s) =>
			s.coverPrompt &&
			!s.coverUrl &&
			s.status !== "pending" &&
			s.status !== "generating_metadata" &&
			s.status !== "error",
	)
	const generatingAudio = allSongs.filter(
		(s) => s.status === "generating_audio",
	)
	const retryPending = allSongs.filter((s) => s.status === "retry_pending")
	const needsRecovery = allSongs.filter(
		(s) =>
			s.status === "generating_metadata" ||
			s.status === "submitting_to_ace" ||
			s.status === "saving",
	)

	// Buffer deficit
	const currentOrderIndex = playlist?.currentOrderIndex ?? 0
	const currentEpoch = playlist?.promptEpoch ?? 0
	const songsAhead = allSongs.filter(
		(s) =>
			s.orderIndex > currentOrderIndex &&
			(ACTIVE_STATUSES as string[]).includes(s.status) &&
			(s.promptEpoch ?? 0) === currentEpoch,
	).length
	const bufferDeficit = Math.max(0, 5 - songsAhead)

	const maxOrderIndex =
		allSongs.length > 0
			? Math.max(...allSongs.map((s) => s.orderIndex))
			: 0
	const transientCount = allSongs.filter((s) =>
		(TRANSIENT_STATUSES as string[]).includes(s.status),
	).length

	// Recent completed songs for diversity
	const completedSongs = allSongs
		.filter(
			(s) =>
				s.title &&
				s.status !== "pending" &&
				s.status !== "generating_metadata",
		)
		.sort((a, b) => b.orderIndex - a.orderIndex)

	const recentCompleted = completedSongs.slice(0, 5).map((s) => ({
		title: s.title!,
		artistName: s.artistName!,
		genre: s.genre!,
		subGenre: s.subGenre!,
		vocalStyle: s.vocalStyle,
		mood: s.mood,
		energy: s.energy,
	}))

	const recentDescriptions = completedSongs
		.slice(0, 20)
		.map((s) => s.description)
		.filter((d): d is string => !!d)

	// Stale song detection
	const STALE_TIMEOUT_MS = 20 * 60 * 1000
	const now = Date.now()
	const staleSongs = allSongs
		.filter((s) => {
			if (!ACTIVE_PROCESSING_STATUSES.includes(s.status)) return false
			if (s.status === "generating_audio") {
				const audioStart =
					s.aceSubmittedAt || s.generationStartedAt || s.createdAt
				return now - audioStart > STALE_TIMEOUT_MS
			}
			const startedAt = s.generationStartedAt || s.createdAt
			return now - startedAt > STALE_TIMEOUT_MS
		})
		.map((s) => ({ _id: s.id, status: s.status, title: s.title }))

	return c.json({
		pending: pending.map(songToWire),
		metadataReady: metadataReady.map(songToWire),
		needsCover: needsCover.map(songToWire),
		generatingAudio: generatingAudio.map(songToWire),
		retryPending: retryPending.map(songToWire),
		needsRecovery: needsRecovery.map(songToWire),
		bufferDeficit,
		maxOrderIndex,
		totalSongs: allSongs.length,
		transientCount,
		currentEpoch,
		recentCompleted,
		recentDescriptions,
		staleSongs,
	})
})

// POST /api/songs/batch — get songs by IDs (body: { ids: [...] })
app.post("/batch", async (c) => {
	const { ids } = await c.req.json<{ ids: string[] }>()
	if (!ids?.length) return c.json([])
	const rows = await db.select().from(songs).where(inArray(songs.id, ids))
	return c.json(rows.filter((s) => s !== null).map(songToWire))
})

// GET /api/songs/:id — get a single song
app.get("/:id", async (c) => {
	const id = c.req.param("id")
	const [row] = await db.select().from(songs).where(eq(songs.id, id))
	if (!row) return c.json(null, 404)
	return c.json(songToWire(row))
})

// ─── Mutations ──────────────────────────────────────────────────────

// POST /api/songs — create a song (full metadata, status=generating_metadata)
app.post("/", async (c) => {
	const body = await c.req.json()
	const [row] = await db
		.insert(songs)
		.values({
			playlistId: body.playlistId,
			orderIndex: body.orderIndex,
			title: body.title,
			artistName: body.artistName,
			genre: body.genre,
			subGenre: body.subGenre,
			lyrics: body.lyrics,
			caption: body.caption,
			coverPrompt: body.coverPrompt,
			bpm: body.bpm,
			keyScale: body.keyScale,
			timeSignature: body.timeSignature,
			audioDuration: body.audioDuration,
			vocalStyle: body.vocalStyle,
			mood: body.mood,
			energy: body.energy,
			era: body.era,
			instruments: body.instruments
				? JSON.stringify(body.instruments)
				: null,
			tags: body.tags ? JSON.stringify(body.tags) : null,
			themes: body.themes ? JSON.stringify(body.themes) : null,
			language: body.language,
			description: body.description,
			isInterrupt: body.isInterrupt,
			interruptPrompt: body.interruptPrompt,
			status: "generating_metadata",
			generationStartedAt: Date.now(),
		})
		.returning()

	await emitSongEvent(row.playlistId, "created", row.id)
	return c.json(songToWire(row))
})

// POST /api/songs/create-pending — create a pending song (worker creates these)
app.post("/create-pending", async (c) => {
	const body = await c.req.json()
	const [row] = await db
		.insert(songs)
		.values({
			playlistId: body.playlistId,
			orderIndex: body.orderIndex,
			status: "pending",
			isInterrupt: body.isInterrupt,
			interruptPrompt: body.interruptPrompt,
			promptEpoch: body.promptEpoch,
			generationStartedAt: Date.now(),
		})
		.returning()

	// Dispatch to worker via RabbitMQ
	await publishWork("metadata", {
		songId: row.id,
		playlistId: row.playlistId,
	})
	await emitSongEvent(row.playlistId, "created", row.id)

	return c.json(songToWire(row))
})

// POST /api/songs/create-metadata-ready — create with metadata already done
app.post("/create-metadata-ready", async (c) => {
	const body = await c.req.json()
	const [row] = await db
		.insert(songs)
		.values({
			playlistId: body.playlistId,
			orderIndex: body.orderIndex,
			promptEpoch: body.promptEpoch,
			title: body.title,
			artistName: body.artistName,
			genre: body.genre,
			subGenre: body.subGenre,
			lyrics: body.lyrics,
			caption: body.caption,
			coverPrompt: body.coverPrompt,
			bpm: body.bpm,
			keyScale: body.keyScale,
			timeSignature: body.timeSignature,
			audioDuration: body.audioDuration,
			vocalStyle: body.vocalStyle,
			mood: body.mood,
			energy: body.energy,
			era: body.era,
			instruments: body.instruments
				? JSON.stringify(body.instruments)
				: null,
			tags: body.tags ? JSON.stringify(body.tags) : null,
			themes: body.themes ? JSON.stringify(body.themes) : null,
			language: body.language,
			description: body.description,
			status: "metadata_ready",
			generationStartedAt: Date.now(),
		})
		.returning()

	// Dispatch audio work
	await publishWork("audio", {
		songId: row.id,
		playlistId: row.playlistId,
	})
	await emitSongEvent(row.playlistId, "created", row.id)

	return c.json(songToWire(row))
})

// PATCH /api/songs/:id/metadata — update metadata fields
app.patch("/:id/metadata", async (c) => {
	const id = c.req.param("id")
	const body = await c.req.json()
	await updateAndEmit(id, buildMetadataPatch(body))
	return c.json({ ok: true })
})

// PATCH /api/songs/:id/status — update status
app.patch("/:id/status", async (c) => {
	const id = c.req.param("id")
	const { status, errorMessage } = await c.req.json<{
		status: string
		errorMessage?: string
	}>()
	const patch: Record<string, unknown> = { status }
	if (errorMessage) patch.errorMessage = errorMessage
	await updateAndEmit(id, patch)
	return c.json({ ok: true })
})

// POST /api/songs/:id/claim-metadata — atomic claim for metadata generation
app.post("/:id/claim-metadata", async (c) => {
	const id = c.req.param("id")

	// Atomic: check-and-set in a single synchronous SQLite transaction
	const result = sqlite.transaction(() => {
		const row = sqlite
			.prepare("SELECT status, playlist_id FROM songs WHERE id = ?")
			.get(id) as { status: string; playlist_id: string } | undefined
		if (!row || row.status !== "pending") return null
		sqlite
			.prepare("UPDATE songs SET status = 'generating_metadata' WHERE id = ?")
			.run(id)
		return row.playlist_id
	})()

	if (result) {
		await emitSongEvent(result, "updated", id)
	}

	return c.json(result !== null)
})

// POST /api/songs/:id/claim-audio — atomic claim for audio generation
app.post("/:id/claim-audio", async (c) => {
	const id = c.req.param("id")

	const result = sqlite.transaction(() => {
		const row = sqlite
			.prepare("SELECT status, playlist_id FROM songs WHERE id = ?")
			.get(id) as { status: string; playlist_id: string } | undefined
		if (!row || row.status !== "metadata_ready") return null
		sqlite
			.prepare(
				"UPDATE songs SET status = 'submitting_to_ace' WHERE id = ?",
			)
			.run(id)
		return row.playlist_id
	})()

	if (result) {
		await emitSongEvent(result, "updated", id)
	}

	return c.json(result !== null)
})

// POST /api/songs/:id/complete-metadata — set metadata + status=metadata_ready
app.post("/:id/complete-metadata", async (c) => {
	const id = c.req.param("id")
	const body = await c.req.json()

	const patch = buildMetadataPatch(body, [
		"llmProvider",
		"llmModel",
		"metadataProcessingMs",
	])
	patch.status = "metadata_ready"

	await db.update(songs).set(patch).where(eq(songs.id, id))

	const [row] = await db.select().from(songs).where(eq(songs.id, id))
	if (row) {
		await publishWork("audio", { songId: id, playlistId: row.playlistId })
		await emitSongEvent(row.playlistId, "updated", id)
	}

	return c.json({ ok: true })
})

// PATCH /api/songs/:id/ace-task — update ACE task info
app.patch("/:id/ace-task", async (c) => {
	const id = c.req.param("id")
	const { aceTaskId } = await c.req.json<{ aceTaskId: string }>()
	await updateAndEmit(id, {
		aceTaskId,
		aceSubmittedAt: Date.now(),
		status: "generating_audio",
	})
	return c.json({ ok: true })
})

// POST /api/songs/:id/mark-ready — mark song as ready with audio URL
app.post("/:id/mark-ready", async (c) => {
	const id = c.req.param("id")
	const { audioUrl, audioProcessingMs } = await c.req.json<{
		audioUrl: string
		audioProcessingMs?: number
	}>()
	const patch: Record<string, unknown> = {
		audioUrl,
		status: "ready",
		generationCompletedAt: Date.now(),
	}
	if (audioProcessingMs !== undefined) {
		patch.audioProcessingMs = audioProcessingMs
	}
	await updateAndEmit(id, patch)
	return c.json({ ok: true })
})

// POST /api/songs/:id/mark-error — mark error, maybe retry
app.post("/:id/mark-error", async (c) => {
	const id = c.req.param("id")
	const { errorMessage, erroredAtStatus } = await c.req.json<{
		errorMessage: string
		erroredAtStatus?: string
	}>()

	const [song] = await db.select().from(songs).where(eq(songs.id, id))
	if (!song) return c.json({ ok: true })

	const retryCount = song.retryCount || 0
	const canRetry = retryCount < 3
	const newStatus = canRetry ? "retry_pending" : "error"

	await db
		.update(songs)
		.set({
			status: newStatus,
			errorMessage,
			erroredAtStatus: erroredAtStatus || song.status,
		})
		.where(eq(songs.id, id))

	if (canRetry) {
		await publishWork("retry", { songId: id, playlistId: song.playlistId })
	}
	await emitSongEvent(song.playlistId, "updated", id)

	return c.json({ ok: true })
})

// PATCH /api/songs/:id/cover — update cover URL
app.patch("/:id/cover", async (c) => {
	const id = c.req.param("id")
	const { coverUrl } = await c.req.json<{ coverUrl: string }>()
	await updateAndEmit(id, { coverUrl })
	return c.json({ ok: true })
})

// POST /api/songs/:id/upload-cover — upload cover image (base64)
app.post("/:id/upload-cover", async (c) => {
	const id = c.req.param("id")
	const { imageBase64 } = await c.req.json<{ imageBase64: string }>()

	const buffer = Buffer.from(imageBase64, "base64")
	const { urlPath } = saveCover(buffer, "png")
	const apiUrl = process.env.API_URL ?? "http://localhost:5175"
	const coverUrl = `${apiUrl}${urlPath}`

	await updateAndEmit(id, { coverUrl })
	return c.json({ ok: true, coverUrl })
})

// PATCH /api/songs/:id/cover-processing-ms
app.patch("/:id/cover-processing-ms", async (c) => {
	const id = c.req.param("id")
	const { coverProcessingMs } = await c.req.json<{
		coverProcessingMs: number
	}>()

	await db.update(songs).set({ coverProcessingMs }).where(eq(songs.id, id))

	return c.json({ ok: true })
})

// PATCH /api/songs/:id/audio-duration
app.patch("/:id/audio-duration", async (c) => {
	const id = c.req.param("id")
	const { audioDuration } = await c.req.json<{ audioDuration: number }>()

	await db.update(songs).set({ audioDuration }).where(eq(songs.id, id))

	return c.json({ ok: true })
})

// PATCH /api/songs/:id/storage-path
app.patch("/:id/storage-path", async (c) => {
	const id = c.req.param("id")
	const { storagePath, aceAudioPath } = await c.req.json<{
		storagePath: string
		aceAudioPath?: string
	}>()
	const patch: Record<string, unknown> = { storagePath }
	if (aceAudioPath) patch.aceAudioPath = aceAudioPath
	await db.update(songs).set(patch).where(eq(songs.id, id))
	return c.json({ ok: true })
})

// POST /api/songs/:id/rating — toggle rating
app.post("/:id/rating", async (c) => {
	const id = c.req.param("id")
	const { rating } = await c.req.json<{ rating: "up" | "down" }>()

	const [song] = await db.select().from(songs).where(eq(songs.id, id))
	if (!song) return c.json({ ok: true })

	const newRating = song.userRating === rating ? null : rating
	await db.update(songs).set({ userRating: newRating }).where(eq(songs.id, id))

	await emitSongEvent(song.playlistId, "updated", id)

	return c.json({ ok: true })
})

// PATCH /api/songs/:id/persona-extract
app.patch("/:id/persona-extract", async (c) => {
	const id = c.req.param("id")
	const { personaExtract } = await c.req.json<{ personaExtract: string }>()

	await db.update(songs).set({ personaExtract }).where(eq(songs.id, id))

	return c.json({ ok: true })
})

// POST /api/songs/:id/listen — increment listen count
app.post("/:id/listen", async (c) => {
	const id = c.req.param("id")
	await db
		.update(songs)
		.set({ listenCount: sql`coalesce(${songs.listenCount}, 0) + 1` })
		.where(eq(songs.id, id))
	return c.json({ ok: true })
})

// POST /api/songs/:id/play-duration — add play duration
app.post("/:id/play-duration", async (c) => {
	const id = c.req.param("id")
	const { durationMs } = await c.req.json<{ durationMs: number }>()
	await db
		.update(songs)
		.set({
			playDurationMs: sql`coalesce(${songs.playDurationMs}, 0) + ${durationMs}`,
		})
		.where(eq(songs.id, id))
	return c.json({ ok: true })
})

// POST /api/songs/:id/retry — retry an errored song
app.post("/:id/retry", async (c) => {
	const id = c.req.param("id")

	const [song] = await db.select().from(songs).where(eq(songs.id, id))
	if (!song || song.status !== "retry_pending") return c.json({ ok: true })

	const revertTo =
		song.erroredAtStatus === "generating_metadata" ? "pending" : "metadata_ready"
	await db
		.update(songs)
		.set({
			status: revertTo,
			retryCount: (song.retryCount || 0) + 1,
			errorMessage: null,
			erroredAtStatus: null,
			generationStartedAt: Date.now(),
		})
		.where(eq(songs.id, id))

	// Dispatch appropriate work
	if (revertTo === "pending") {
		await publishWork("metadata", {
			songId: id,
			playlistId: song.playlistId,
		})
	} else {
		await publishWork("audio", {
			songId: id,
			playlistId: song.playlistId,
		})
	}
	await emitSongEvent(song.playlistId, "updated", id)

	return c.json({ ok: true })
})

// DELETE /api/songs/:id — delete a song
app.delete("/:id", async (c) => {
	const id = c.req.param("id")

	const [song] = await db.select().from(songs).where(eq(songs.id, id))
	const playlistId = song?.playlistId

	await db.delete(songs).where(eq(songs.id, id))

	if (playlistId) await emitSongEvent(playlistId, "deleted", id)

	return c.json({ ok: true })
})

// POST /api/songs/:id/revert — revert a single song's transient status
app.post("/:id/revert", async (c) => {
	const id = c.req.param("id")

	const [song] = await db.select().from(songs).where(eq(songs.id, id))
	if (!song) return c.json({ ok: true })

	if (song.status === "generating_metadata") {
		await db
			.update(songs)
			.set({ status: "pending", generationStartedAt: Date.now() })
			.where(eq(songs.id, id))
	} else if (
		["submitting_to_ace", "generating_audio", "saving"].includes(song.status)
	) {
		await db
			.update(songs)
			.set({
				status: "metadata_ready",
				aceTaskId: null,
				aceSubmittedAt: null,
				generationStartedAt: Date.now(),
			})
			.where(eq(songs.id, id))
	}

	await emitSongEvent(song.playlistId, "updated", id)

	return c.json({ ok: true })
})

// POST /api/songs/revert-transient/:playlistId — revert all transient statuses in playlist
app.post("/revert-transient/:playlistId", async (c) => {
	const playlistId = c.req.param("playlistId")

	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))

	for (const song of rows) {
		if (song.status === "generating_metadata") {
			await db
				.update(songs)
				.set({ status: "pending" })
				.where(eq(songs.id, song.id))
		} else if (
			["submitting_to_ace", "generating_audio", "saving"].includes(
				song.status,
			)
		) {
			await db
				.update(songs)
				.set({ status: "metadata_ready" })
				.where(eq(songs.id, song.id))
		}
	}

	await emitSongEvent(playlistId, "updated")

	return c.json({ ok: true })
})

// POST /api/songs/recover/:playlistId — smart recovery from worker restart
app.post("/recover/:playlistId", async (c) => {
	const playlistId = c.req.param("playlistId")

	const recoveryMap: Record<string, string> = {
		generating_metadata: "pending",
		submitting_to_ace: "metadata_ready",
		saving: "generating_audio",
	}

	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))

	let recovered = 0
	for (const song of rows) {
		const revertTo = recoveryMap[song.status]
		if (revertTo) {
			await db
				.update(songs)
				.set({ status: revertTo })
				.where(eq(songs.id, song.id))
			recovered++
		}
	}

	if (recovered > 0) {
		await emitSongEvent(playlistId, "updated")
	}

	return c.json(recovered)
})

// POST /api/songs/:id/revert-to-metadata-ready
app.post("/:id/revert-to-metadata-ready", async (c) => {
	const id = c.req.param("id")
	await updateAndEmit(id, {
		status: "metadata_ready",
		aceTaskId: null,
		aceSubmittedAt: null,
		aceAudioPath: null,
	})
	return c.json({ ok: true })
})

// PATCH /api/songs/:id/order — reorder a song
app.patch("/:id/order", async (c) => {
	const id = c.req.param("id")
	const { newOrderIndex } = await c.req.json<{ newOrderIndex: number }>()
	await updateAndEmit(id, { orderIndex: newOrderIndex }, "reordered")
	return c.json({ ok: true })
})

// POST /api/songs/reindex/:playlistId — reindex all songs in a playlist
app.post("/reindex/:playlistId", async (c) => {
	const playlistId = c.req.param("playlistId")

	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))
	const sorted = [...rows].sort((a, b) => a.orderIndex - b.orderIndex)

	for (let i = 0; i < sorted.length; i++) {
		const cleanIndex = i + 1
		if (sorted[i].orderIndex !== cleanIndex) {
			await db
				.update(songs)
				.set({ orderIndex: cleanIndex })
				.where(eq(songs.id, sorted[i].id))
		}
	}

	await emitSongEvent(playlistId, "reindexed")

	return c.json({ ok: true })
})

export default app
