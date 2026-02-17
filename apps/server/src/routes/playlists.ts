import {
	CreatePlaylistSchema,
	UpdatePlaylistParamsSchema,
	UpdatePlaylistPositionSchema,
	UpdatePlaylistPromptSchema,
	UpdatePlaylistStatusSchema,
} from "@infinitune/shared/validation/playlist-schemas";
import { Hono } from "hono";
import * as playlistService from "../services/playlist-service";
import { playlistToWire } from "../wire";

const app = new Hono();

// ─── Queries ────────────────────────────────────────────────────────

// GET /api/playlists
app.get("/", async (c) => {
	return c.json(await playlistService.listAll());
});

// GET /api/playlists/current
app.get("/current", async (c) => {
	return c.json(await playlistService.getCurrent());
});

// GET /api/playlists/closed
app.get("/closed", async (c) => {
	return c.json(await playlistService.listClosed());
});

// GET /api/playlists/worker — active + closing playlists
app.get("/worker", async (c) => {
	return c.json(await playlistService.listActive());
});

// GET /api/playlists/by-key/:key
app.get("/by-key/:key", async (c) => {
	return c.json(await playlistService.getByKey(c.req.param("key")));
});

// GET /api/playlists/:id
app.get("/:id", async (c) => {
	const playlist = await playlistService.getById(c.req.param("id"));
	if (!playlist) return c.json(null, 404);
	return c.json(playlistToWire(playlist));
});

// ─── Mutations ──────────────────────────────────────────────────────

// POST /api/playlists
app.post("/", async (c) => {
	const body = await c.req.json();
	const result = CreatePlaylistSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	return c.json(await playlistService.create(result.data));
});

// PATCH /api/playlists/:id/params
app.patch("/:id/params", async (c) => {
	const body = await c.req.json();
	const result = UpdatePlaylistParamsSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await playlistService.updateParams(c.req.param("id"), result.data);
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/status
app.patch("/:id/status", async (c) => {
	const body = await c.req.json();
	const result = UpdatePlaylistStatusSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await playlistService.updateStatus(c.req.param("id"), result.data.status);
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/position
app.patch("/:id/position", async (c) => {
	const body = await c.req.json();
	const result = UpdatePlaylistPositionSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await playlistService.updatePosition(
		c.req.param("id"),
		result.data.currentOrderIndex,
	);
	return c.json({ ok: true });
});

// POST /api/playlists/:id/increment-generated
app.post("/:id/increment-generated", async (c) => {
	await playlistService.incrementGenerated(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/playlists/:id/reset-defaults
app.post("/:id/reset-defaults", async (c) => {
	await playlistService.resetDefaults(c.req.param("id"));
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/prompt — steering
app.patch("/:id/prompt", async (c) => {
	const body = await c.req.json();
	const result = UpdatePlaylistPromptSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await playlistService.steer(c.req.param("id"), result.data.prompt);
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/star — toggle starred status
app.patch("/:id/star", async (c) => {
	const result = await playlistService.toggleStar(c.req.param("id"));
	if (!result) return c.json({ error: "Playlist not found" }, 404);
	return c.json(result);
});

// DELETE /api/playlists/:id
app.delete("/:id", async (c) => {
	await playlistService.deletePlaylist(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/playlists/:id/heartbeat
app.post("/:id/heartbeat", async (c) => {
	await playlistService.heartbeat(c.req.param("id"));
	return c.json({ ok: true });
});

export default app;
