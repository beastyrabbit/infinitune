import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { settings } from "../db/schema"
import { publishEvent } from "../rabbit"

const app = new Hono()

// GET /api/settings — get all settings as { key: value } map
app.get("/", async (c) => {
	const rows = await db.select().from(settings)
	const map = Object.fromEntries(rows.map((s) => [s.key, s.value]))
	return c.json(map)
})

// GET /api/settings/:key — get a single setting value
app.get("/:key", async (c) => {
	const key = c.req.param("key")
	const [row] = await db.select().from(settings).where(eq(settings.key, key))
	return c.json(row?.value ?? null)
})

// POST /api/settings — set a setting { key, value }
app.post("/", async (c) => {
	const { key, value } = await c.req.json<{ key: string; value: string }>()

	await db
		.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value },
		})

	await publishEvent("settings", { key })

	return c.json({ ok: true })
})

export default app
