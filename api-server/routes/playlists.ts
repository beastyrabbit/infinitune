import { Hono } from "hono"
import { eq, and, or, ne, sql, desc } from "drizzle-orm"
import { db } from "../db/index"
import { playlists } from "../db/schema"
import { playlistToWire, parseJsonField } from "../wire"
import { publishEvent } from "../rabbit"

const app = new Hono()

// GET /api/playlists — list all playlists
app.get("/", async (c) => {
	const rows = await db.select().from(playlists)
	return c.json(rows.map(playlistToWire))
})

// GET /api/playlists/current — get most recent active/closing playlist (excludes oneshot)
app.get("/current", async (c) => {
	const [row] = await db
		.select()
		.from(playlists)
		.where(
			and(
				or(eq(playlists.status, "active"), eq(playlists.status, "closing")),
				ne(playlists.mode, "oneshot"),
			),
		)
		.orderBy(desc(playlists.createdAt))
		.limit(1)
	return c.json(row ? playlistToWire(row) : null)
})

// GET /api/playlists/closed — list closed/closing playlists (excludes oneshot), newest first
app.get("/closed", async (c) => {
	const rows = await db
		.select()
		.from(playlists)
		.where(
			and(
				or(eq(playlists.status, "closed"), eq(playlists.status, "closing")),
				ne(playlists.mode, "oneshot"),
			),
		)
		.orderBy(desc(playlists.createdAt))
	return c.json(rows.map(playlistToWire))
})

// GET /api/playlists/worker — list active + closing playlists (for worker)
app.get("/worker", async (c) => {
	const rows = await db
		.select()
		.from(playlists)
		.where(or(eq(playlists.status, "active"), eq(playlists.status, "closing")))
	return c.json(rows.map(playlistToWire))
})

// GET /api/playlists/by-key/:key — find playlist by playlistKey
app.get("/by-key/:key", async (c) => {
	const key = c.req.param("key")
	const [row] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.playlistKey, key))
	return c.json(row ? playlistToWire(row) : null)
})

// GET /api/playlists/:id — get a single playlist
app.get("/:id", async (c) => {
	const id = c.req.param("id")
	const [row] = await db.select().from(playlists).where(eq(playlists.id, id))
	if (!row) return c.json(null, 404)
	return c.json(playlistToWire(row))
})

// POST /api/playlists — create a playlist
app.post("/", async (c) => {
	const body = await c.req.json()
	for (const field of ["name", "prompt", "llmProvider", "llmModel"] as const) {
		if (!body[field] || typeof body[field] !== "string") {
			return c.json({ error: `${field} is required` }, 400)
		}
	}
	const [row] = await db
		.insert(playlists)
		.values({
			name: body.name,
			prompt: body.prompt,
			llmProvider: body.llmProvider,
			llmModel: body.llmModel,
			mode: body.mode ?? "endless",
			status: "active",
			songsGenerated: 0,
			promptEpoch: 0,
			playlistKey: body.playlistKey,
			lyricsLanguage: body.lyricsLanguage,
			targetBpm: body.targetBpm,
			targetKey: body.targetKey,
			timeSignature: body.timeSignature,
			audioDuration: body.audioDuration,
			inferenceSteps: body.inferenceSteps,
			lmTemperature: body.lmTemperature,
			lmCfgScale: body.lmCfgScale,
			inferMethod: body.inferMethod,
		})
		.returning()

	await publishEvent("playlists", { playlistId: row.id, type: "created" })

	return c.json(playlistToWire(row))
})

// PATCH /api/playlists/:id/params — update generation params
app.patch("/:id/params", async (c) => {
	const id = c.req.param("id")
	const body = await c.req.json()

	const patch: Record<string, unknown> = {}
	for (const key of [
		"lyricsLanguage",
		"targetBpm",
		"targetKey",
		"timeSignature",
		"audioDuration",
		"inferenceSteps",
		"lmTemperature",
		"lmCfgScale",
		"inferMethod",
	]) {
		if (body[key] !== undefined) {
			patch[key] = body[key]
		}
	}

	if (Object.keys(patch).length > 0) {
		await db.update(playlists).set(patch).where(eq(playlists.id, id))
	}

	await publishEvent("playlists", { playlistId: id, type: "updated" })

	return c.json({ ok: true })
})

// PATCH /api/playlists/:id/status — update status
app.patch("/:id/status", async (c) => {
	const id = c.req.param("id")
	const { status } = await c.req.json<{ status: string }>()

	await db.update(playlists).set({ status }).where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "updated" })

	return c.json({ ok: true })
})

// PATCH /api/playlists/:id/position — update currentOrderIndex
app.patch("/:id/position", async (c) => {
	const id = c.req.param("id")
	const { currentOrderIndex } = await c.req.json<{
		currentOrderIndex: number
	}>()

	await db
		.update(playlists)
		.set({ currentOrderIndex })
		.where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "updated" })

	return c.json({ ok: true })
})

// POST /api/playlists/:id/increment-generated — increment songsGenerated
app.post("/:id/increment-generated", async (c) => {
	const id = c.req.param("id")
	await db
		.update(playlists)
		.set({ songsGenerated: sql`${playlists.songsGenerated} + 1` })
		.where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "updated" })
	return c.json({ ok: true })
})

// POST /api/playlists/:id/reset-defaults — clear generation param overrides
app.post("/:id/reset-defaults", async (c) => {
	const id = c.req.param("id")

	await db
		.update(playlists)
		.set({
			lyricsLanguage: null,
			targetBpm: null,
			targetKey: null,
			timeSignature: null,
			audioDuration: null,
			inferenceSteps: null,
			lmTemperature: null,
			lmCfgScale: null,
			inferMethod: null,
		})
		.where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "updated" })

	return c.json({ ok: true })
})

// PATCH /api/playlists/:id/prompt — update prompt (steering)
app.patch("/:id/prompt", async (c) => {
	const id = c.req.param("id")
	const { prompt } = await c.req.json<{ prompt: string }>()

	const [row] = await db.select().from(playlists).where(eq(playlists.id, id))
	if (!row) return c.json({ error: "Playlist not found" }, 404)

	const newEpoch = (row.promptEpoch ?? 0) + 1
	const history: Array<{ epoch: number; direction: string; at: number }> =
		parseJsonField<Array<{ epoch: number; direction: string; at: number }>>(row.steerHistory) ?? []
	history.push({ epoch: newEpoch, direction: prompt, at: Date.now() })

	await db
		.update(playlists)
		.set({
			prompt,
			promptEpoch: newEpoch,
			steerHistory: JSON.stringify(history),
		})
		.where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "steered" })

	return c.json({ ok: true })
})

// DELETE /api/playlists/:id — delete playlist (cascades to songs)
app.delete("/:id", async (c) => {
	const id = c.req.param("id")

	await db.delete(playlists).where(eq(playlists.id, id))
	await publishEvent("playlists", { playlistId: id, type: "deleted" })

	return c.json({ ok: true })
})

// POST /api/playlists/:id/heartbeat — update lastSeenAt, re-activate if needed
app.post("/:id/heartbeat", async (c) => {
	const id = c.req.param("id")

	const [row] = await db.select().from(playlists).where(eq(playlists.id, id))
	if (!row) return c.json({ ok: true })

	const patch: Record<string, unknown> = { lastSeenAt: Date.now() }
	const shouldReactivate = row.status === "closing"
	if (shouldReactivate) {
		patch.status = "active"
	}

	await db.update(playlists).set(patch).where(eq(playlists.id, id))
	if (shouldReactivate) {
		await publishEvent("playlists", { playlistId: id, type: "updated" })
	}

	return c.json({ ok: true })
})

export default app
