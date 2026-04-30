import {
	CreatePlaylistSchema,
	UpdatePlaylistParamsSchema,
	UpdatePlaylistPositionSchema,
	UpdatePlaylistPromptSchema,
	UpdatePlaylistStatusSchema,
} from "@infinitune/shared/validation/playlist-schemas";
import { type Context, Hono } from "hono";
import z from "zod";
import { readChannelMessages } from "../agents/channel-store";
import {
	answerDirectorQuestion,
	DirectorQuestionValidationError,
	getPlaylistChatState,
	initializePlaylistDirectorPlan,
	postHumanChat,
} from "../agents/playlist-director-service";
import { getRequestActor, type RequestActor } from "../auth/actor";
import { logger } from "../logger";
import * as playlistService from "../services/playlist-service";
import { type PlaylistWire, playlistToWire } from "../wire";

const app = new Hono();
const ANONYMOUS_PLAYLIST_TTL_MS = 24 * 60 * 60 * 1000;

function canAccessPlaylist(
	actor: RequestActor,
	playlist: PlaylistWire,
): boolean {
	if (!playlist.ownerUserId) return true;
	return actor.kind === "user" && playlist.ownerUserId === actor.userId;
}

function filterAccessiblePlaylists<T extends PlaylistWire>(
	actor: RequestActor,
	playlists: T[],
): T[] {
	return playlists.filter((playlist) => canAccessPlaylist(actor, playlist));
}

async function loadAccessiblePlaylist(
	c: Context,
): Promise<{ playlist: PlaylistWire } | Response> {
	const actor = await getRequestActor(c);
	const playlist = await playlistService.getById(c.req.param("id"));
	if (!playlist) return c.json(null, 404);
	const wire = playlistToWire(playlist);
	if (!canAccessPlaylist(actor, wire)) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	return { playlist: wire };
}

// ─── Queries ────────────────────────────────────────────────────────

// GET /api/playlists
app.get("/", async (c) => {
	const actor = await getRequestActor(c);
	return c.json(
		filterAccessiblePlaylists(actor, await playlistService.listAll()),
	);
});

// GET /api/playlists/current
app.get("/current", async (c) => {
	const actor = await getRequestActor(c);
	const current =
		filterAccessiblePlaylists(actor, await playlistService.listActive())
			.filter((playlist) => playlist.mode !== "oneshot")
			.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
	return c.json(current);
});

// GET /api/playlists/closed
app.get("/closed", async (c) => {
	const actor = await getRequestActor(c);
	return c.json(
		filterAccessiblePlaylists(actor, await playlistService.listClosed()),
	);
});

// GET /api/playlists/worker — active + closing playlists
app.get("/worker", async (c) => {
	const actor = await getRequestActor(c);
	return c.json(
		filterAccessiblePlaylists(actor, await playlistService.listActive()),
	);
});

// GET /api/playlists/by-key/:key
app.get("/by-key/:key", async (c) => {
	const actor = await getRequestActor(c);
	const playlist = await playlistService.getByKey(c.req.param("key"));
	if (!playlist || !canAccessPlaylist(actor, playlist))
		return c.json(null, 404);
	return c.json(playlist);
});

// GET /api/playlists/:id
app.get("/:id", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	return c.json(access.playlist);
});

const ChatMessageSchema = z.object({
	content: z.string().min(1),
	threadId: z.string().nullable().optional(),
	commitDirection: z.boolean().optional(),
});

const ChatAnswerSchema = z.object({
	questionId: z.string().min(1),
	content: z.string().min(1),
});

// GET /api/playlists/:id/agent-chat/messages
app.get("/:id/agent-chat/messages", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const limit = Number.parseInt(c.req.query("limit") ?? "", 10);
	const types = c.req
		.query("types")
		?.split(",")
		.map((type) => type.trim())
		.filter(Boolean);
	const messages = await readChannelMessages({
		playlistId: c.req.param("id"),
		threadId: c.req.query("threadId") ?? undefined,
		sinceId: c.req.query("sinceId") ?? undefined,
		limit: Number.isFinite(limit) ? limit : undefined,
		types: types as Parameters<typeof readChannelMessages>[0]["types"],
	});
	return c.json({ messages });
});

// POST /api/playlists/:id/agent-chat/messages
app.post("/:id/agent-chat/messages", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const body = await c.req.json();
	const result = ChatMessageSchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(
		await postHumanChat({
			playlistId: c.req.param("id"),
			content: result.data.content,
			threadId: result.data.threadId,
			commitDirection: result.data.commitDirection,
		}),
	);
});

// GET /api/playlists/:id/agent-chat/state
app.get("/:id/agent-chat/state", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	return c.json(await getPlaylistChatState(c.req.param("id")));
});

// POST /api/playlists/:id/agent-chat/answer
app.post("/:id/agent-chat/answer", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const body = await c.req.json();
	const result = ChatAnswerSchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	try {
		return c.json(
			await answerDirectorQuestion({
				playlistId: c.req.param("id"),
				questionId: result.data.questionId,
				content: result.data.content,
			}),
		);
	} catch (error) {
		if (!(error instanceof DirectorQuestionValidationError)) throw error;
		return c.json({ error: error.message }, 400);
	}
});

// ─── Mutations ──────────────────────────────────────────────────────

// POST /api/playlists
app.post("/", async (c) => {
	const body = await c.req.json();
	const result = CreatePlaylistSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const actor = await getRequestActor(c);
	const createPayload = { ...result.data };
	const initialDirectorPlan = createPayload.initialDirectorPlan === true;
	delete createPayload.initialDirectorPlan;

	if (createPayload.ownerUserId && actor.kind !== "user") {
		return c.json({ error: "ownerUserId requires authenticated user" }, 401);
	}

	if (actor.kind === "user") {
		createPayload.ownerUserId = actor.userId;
		if (createPayload.isTemporary === undefined) {
			createPayload.isTemporary = false;
		}
	} else {
		createPayload.ownerUserId = undefined;
		createPayload.isTemporary = true;
		createPayload.expiresAt = Date.now() + ANONYMOUS_PLAYLIST_TTL_MS;
	}

	const playlist = await playlistService.create({
		...createPayload,
		emitCreated: !initialDirectorPlan,
	});

	if (initialDirectorPlan) {
		try {
			await initializePlaylistDirectorPlan({
				playlistId: playlist.id,
				provider: playlist.llmProvider,
				model: playlist.llmModel,
			});
		} catch (err) {
			logger.warn(
				{ err, playlistId: playlist.id },
				"Initial director plan failed; starting playlist with worker fallback",
			);
		} finally {
			playlistService.announceCreated(playlist.id);
		}
	}

	const refreshed = await playlistService.getById(playlist.id);
	return c.json(refreshed ? playlistToWire(refreshed) : playlist);
});

// PATCH /api/playlists/:id/params
app.patch("/:id/params", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
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
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
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
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
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
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	await playlistService.incrementGenerated(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/playlists/:id/reset-defaults
app.post("/:id/reset-defaults", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	await playlistService.resetDefaults(c.req.param("id"));
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/prompt — steering
app.patch("/:id/prompt", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
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
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const result = await playlistService.toggleStar(c.req.param("id"));
	if (!result) return c.json({ error: "Playlist not found" }, 404);
	return c.json(result);
});

// DELETE /api/playlists/:id
app.delete("/:id", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	await playlistService.deletePlaylist(c.req.param("id"));
	return c.json({ ok: true });
});

// POST /api/playlists/:id/heartbeat
app.post("/:id/heartbeat", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	await playlistService.heartbeat(c.req.param("id"));
	return c.json({ ok: true });
});

export default app;
