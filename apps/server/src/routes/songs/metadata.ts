import {
	ReorderSongSchema,
	UpdateAudioDurationSchema,
	UpdateCoverProcessingMsSchema,
	UpdateCoverSchema,
	UpdateMetadataSchema,
	UpdatePersonaExtractSchema,
	UpdateStoragePathSchema,
	UploadCoverSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import { saveCover } from "../../covers";
import * as songService from "../../services/song-service";

const app = new Hono();

// PATCH /api/songs/:id/metadata — update metadata fields
app.patch("/:id/metadata", async (c) => {
	const body = await c.req.json();
	const result = UpdateMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateMetadata(c.req.param("id"), result.data);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/cover
app.patch("/:id/cover", async (c) => {
	const body = await c.req.json();
	const result = UpdateCoverSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateCover(c.req.param("id"), result.data.coverUrl);
	return c.json({ ok: true });
});

// POST /api/songs/:id/upload-cover — upload cover image (base64)
app.post("/:id/upload-cover", async (c) => {
	const body = await c.req.json();
	const result = UploadCoverSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const buffer = Buffer.from(result.data.imageBase64, "base64");
	const { urlPath } = saveCover(buffer, "png");
	const apiUrl = process.env.API_URL ?? "http://localhost:5175";
	const coverUrl = `${apiUrl}${urlPath}`;

	await songService.updateCover(c.req.param("id"), coverUrl);
	return c.json({ ok: true, coverUrl });
});

// PATCH /api/songs/:id/cover-processing-ms
app.patch("/:id/cover-processing-ms", async (c) => {
	const body = await c.req.json();
	const result = UpdateCoverProcessingMsSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateCoverProcessingMs(
		c.req.param("id"),
		result.data.coverProcessingMs,
	);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/audio-duration
app.patch("/:id/audio-duration", async (c) => {
	const body = await c.req.json();
	const result = UpdateAudioDurationSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateAudioDuration(
		c.req.param("id"),
		result.data.audioDuration,
	);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/storage-path
app.patch("/:id/storage-path", async (c) => {
	const body = await c.req.json();
	const result = UpdateStoragePathSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateStoragePath(
		c.req.param("id"),
		result.data.storagePath,
		result.data.aceAudioPath,
	);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/persona-extract
app.patch("/:id/persona-extract", async (c) => {
	const body = await c.req.json();
	const result = UpdatePersonaExtractSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updatePersonaExtract(
		c.req.param("id"),
		result.data.personaExtract,
	);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/order — reorder a song
app.patch("/:id/order", async (c) => {
	const body = await c.req.json();
	const result = ReorderSongSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.reorderSong(c.req.param("id"), result.data.newOrderIndex);
	return c.json({ ok: true });
});

// POST /api/songs/reindex/:playlistId
app.post("/reindex/:playlistId", async (c) => {
	await songService.reindexPlaylist(c.req.param("playlistId"));
	return c.json({ ok: true });
});

export default app;
