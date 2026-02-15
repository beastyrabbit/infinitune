import { CreatePendingSongSchema } from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import * as songService from "../../services/song-service";

const app = new Hono();

// POST /api/songs — create a song with full metadata (status=generating_metadata)
app.post("/", async (c) => {
	const body = await c.req.json();
	if (!body.playlistId || typeof body.playlistId !== "string") {
		return c.json({ error: "playlistId is required" }, 400);
	}
	if (body.orderIndex == null || typeof body.orderIndex !== "number") {
		return c.json({ error: "orderIndex is required (number)" }, 400);
	}
	return c.json(
		await songService.createWithMetadata(
			body.playlistId,
			body.orderIndex,
			body,
		),
	);
});

// POST /api/songs/create-pending — create a pending song
app.post("/create-pending", async (c) => {
	const body = await c.req.json();
	const result = CreatePendingSongSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...opts } = result.data;
	return c.json(await songService.createPending(playlistId, orderIndex, opts));
});

// POST /api/songs/create-metadata-ready — create with metadata already done
app.post("/create-metadata-ready", async (c) => {
	const body = await c.req.json();
	if (!body.playlistId || typeof body.playlistId !== "string") {
		return c.json({ error: "playlistId is required" }, 400);
	}
	if (body.orderIndex == null || typeof body.orderIndex !== "number") {
		return c.json({ error: "orderIndex is required (number)" }, 400);
	}
	return c.json(
		await songService.createWithMetadata(
			body.playlistId,
			body.orderIndex,
			body,
		),
	);
});

export default app;
