import {
	CompleteSongMetadataSchema,
	MarkSongErrorSchema,
	MarkSongReadySchema,
	UpdateAceTaskSchema,
	UpdateSongStatusSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import * as songService from "../../services/song-service";

const app = new Hono();

// PATCH /api/songs/:id/status
app.patch("/:id/status", async (c) => {
	const body = await c.req.json();
	const result = UpdateSongStatusSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateStatus(c.req.param("id"), result.data.status, {
		errorMessage: result.data.errorMessage,
	});
	return c.json({ ok: true });
});

// POST /api/songs/:id/claim-metadata — atomic claim
app.post("/:id/claim-metadata", async (c) => {
	return c.json(songService.claimMetadata(c.req.param("id")));
});

// POST /api/songs/:id/claim-audio — atomic claim
app.post("/:id/claim-audio", async (c) => {
	return c.json(songService.claimAudio(c.req.param("id")));
});

// POST /api/songs/:id/complete-metadata
app.post("/:id/complete-metadata", async (c) => {
	const body = await c.req.json();
	const result = CompleteSongMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.completeMetadata(c.req.param("id"), result.data);
	return c.json({ ok: true });
});

// PATCH /api/songs/:id/ace-task
app.patch("/:id/ace-task", async (c) => {
	const body = await c.req.json();
	const result = UpdateAceTaskSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.updateAceTask(c.req.param("id"), result.data.aceTaskId);
	return c.json({ ok: true });
});

// POST /api/songs/:id/mark-ready
app.post("/:id/mark-ready", async (c) => {
	const body = await c.req.json();
	const result = MarkSongReadySchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.markReady(
		c.req.param("id"),
		result.data.audioUrl,
		result.data.audioProcessingMs,
	);
	return c.json({ ok: true });
});

// POST /api/songs/:id/mark-error
app.post("/:id/mark-error", async (c) => {
	const body = await c.req.json();
	const result = MarkSongErrorSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await songService.markError(
		c.req.param("id"),
		result.data.errorMessage,
		result.data.erroredAtStatus,
	);
	return c.json({ ok: true });
});

// POST /api/songs/:id/retry
app.post("/:id/retry", async (c) => {
	await songService.retryErrored(c.req.param("id"));
	return c.json({ ok: true });
});

// DELETE /api/songs/:id
app.delete("/:id", async (c) => {
	await songService.deleteSong(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/songs/:id/revert — revert a single song's transient status
app.post("/:id/revert", async (c) => {
	await songService.revertTransient(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/songs/revert-transient/:playlistId — revert all transient in playlist
app.post("/revert-transient/:playlistId", async (c) => {
	await songService.revertAllTransient(c.req.param("playlistId"));
	return c.json({ ok: true });
});

// POST /api/songs/recover/:playlistId — smart recovery from restart
app.post("/recover/:playlistId", async (c) => {
	const recovered = await songService.recoverPlaylist(
		c.req.param("playlistId"),
	);
	return c.json(recovered);
});

// POST /api/songs/:id/revert-to-metadata-ready
app.post("/:id/revert-to-metadata-ready", async (c) => {
	await songService.updateStatus(c.req.param("id"), "metadata_ready");
	return c.json({ ok: true });
});

export default app;
