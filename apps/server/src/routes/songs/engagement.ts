import {
	PlayDurationSchema,
	RateSongSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import * as songService from "../../services/song-service";

const app = new Hono();

// POST /api/songs/:id/rating — toggle rating
app.post("/:id/rating", async (c) => {
	const body = await c.req.json();
	const result = RateSongSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.rateSong(c.req.param("id"), result.data.rating);
	return c.json({ ok: true });
});

// POST /api/songs/:id/listen — increment listen count
app.post("/:id/listen", async (c) => {
	await songService.incrementListenCount(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/songs/:id/play-duration — add play duration
app.post("/:id/play-duration", async (c) => {
	const body = await c.req.json();
	const result = PlayDurationSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.addPlayDuration(c.req.param("id"), result.data.durationMs);
	return c.json({ ok: true });
});

export default app;
