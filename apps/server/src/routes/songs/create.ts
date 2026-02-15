import {
	CompleteSongMetadataSchema,
	CreatePendingSongSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import * as songService from "../../services/song-service";

const app = new Hono();

const CreateWithMetadataSchema = CompleteSongMetadataSchema.extend({
	playlistId: CreatePendingSongSchema.shape.playlistId,
	orderIndex: CreatePendingSongSchema.shape.orderIndex,
	promptEpoch: CreatePendingSongSchema.shape.promptEpoch,
});

// POST /api/songs — create a song with full metadata (status=generating_metadata)
app.post("/", async (c) => {
	const body = await c.req.json();
	const result = CreateWithMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...metadata } = result.data;
	return c.json(
		await songService.createWithMetadata(playlistId, orderIndex, metadata),
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
	const result = CreateWithMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...metadata } = result.data;
	return c.json(
		await songService.createWithMetadata(playlistId, orderIndex, metadata),
	);
});

export default app;
