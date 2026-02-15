import { BatchSongIdsSchema } from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import * as songService from "../../services/song-service";
import { songToWire } from "../../wire";

const app = new Hono();

// GET /api/songs — list all songs (with metadata), newest first
app.get("/", async (c) => {
	return c.json(await songService.listAll());
});

// GET /api/songs/by-playlist/:playlistId
app.get("/by-playlist/:playlistId", async (c) => {
	return c.json(await songService.listByPlaylist(c.req.param("playlistId")));
});

// GET /api/songs/queue/:playlistId — alias for by-playlist
app.get("/queue/:playlistId", async (c) => {
	return c.json(await songService.listByPlaylist(c.req.param("playlistId")));
});

// GET /api/songs/next-order-index/:playlistId
app.get("/next-order-index/:playlistId", async (c) => {
	return c.json(await songService.getNextOrderIndex(c.req.param("playlistId")));
});

// GET /api/songs/in-audio-pipeline
app.get("/in-audio-pipeline", async (c) => {
	return c.json(await songService.getInAudioPipeline());
});

// GET /api/songs/needs-persona
app.get("/needs-persona", async (c) => {
	return c.json(await songService.getNeedsPersona());
});

// GET /api/songs/work-queue/:playlistId
app.get("/work-queue/:playlistId", async (c) => {
	return c.json(await songService.getWorkQueue(c.req.param("playlistId")));
});

// POST /api/songs/batch — get songs by IDs
app.post("/batch", async (c) => {
	const body = await c.req.json();
	const result = BatchSongIdsSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	return c.json(await songService.getByIds(result.data.ids));
});

// GET /api/songs/:id
app.get("/:id", async (c) => {
	const song = await songService.getById(c.req.param("id"));
	if (!song) return c.json(null, 404);
	return c.json(songToWire(song));
});

export default app;
