import { normalizeLlmProvider } from "@infinitune/shared/text-llm-profile";
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
	MAX_HUMAN_CHAT_CONTENT_CHARS,
	postHumanChat,
} from "../agents/playlist-director-service";
import { getRequestActor, type RequestActor } from "../auth/actor";
import { getDeviceActor } from "../auth/device";
import { logger } from "../logger";
import { generationLimiter, llmLimiter } from "../middleware/limiters";
import * as playlistService from "../services/playlist-service";
import { RADIO_PLAYLIST_KEY } from "../services/radio-constants";
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

type PlaybackAccess = {
	actor: RequestActor;
	deviceOwnerUserId: string | null;
};

async function getPlaybackAccess(c: Context): Promise<PlaybackAccess> {
	const [actor, device] = await Promise.all([
		getRequestActor(c),
		getDeviceActor(c),
	]);
	return { actor, deviceOwnerUserId: device?.ownerUserId ?? null };
}

function canPlaybackAccessPlaylist(
	access: PlaybackAccess,
	playlist: PlaylistWire,
): boolean {
	return (
		canAccessPlaylist(access.actor, playlist) ||
		(Boolean(playlist.ownerUserId) &&
			playlist.ownerUserId === access.deviceOwnerUserId)
	);
}

function filterPlaybackAccessiblePlaylists<T extends PlaylistWire>(
	access: PlaybackAccess,
	playlists: T[],
): T[] {
	return playlists.filter((playlist) =>
		canPlaybackAccessPlaylist(access, playlist),
	);
}

/** The global radio's hidden generation playlist must not surface in
 *  normal playlist listings or as the user's "current" playlist. */
function isHiddenRadioPlaylist(playlist: PlaylistWire): boolean {
	return playlist.mode === "radio";
}

async function loadAccessiblePlaylist(
	c: Context,
): Promise<{ actor: RequestActor; playlist: PlaylistWire } | Response> {
	const actor = await getRequestActor(c);
	const playlist = await playlistService.getById(c.req.param("id"));
	if (!playlist) return c.json(null, 404);
	const wire = playlistToWire(playlist);
	if (!canAccessPlaylist(actor, wire)) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	return { actor, playlist: wire };
}

async function loadPlaybackAccessiblePlaylist(
	c: Context,
): Promise<{ actor: RequestActor; playlist: PlaylistWire } | Response> {
	const access = await getPlaybackAccess(c);
	const playlist = await playlistService.getById(c.req.param("id"));
	if (!playlist) return c.json(null, 404);
	const wire = playlistToWire(playlist);
	if (!canPlaybackAccessPlaylist(access, wire)) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	return { actor: access.actor, playlist: wire };
}

function requiresOpenRouterSpendAuthentication(input: {
	actor: RequestActor;
	ownerUserId: string | null;
	provider: string;
}): boolean {
	return (
		process.env.NODE_ENV === "production" &&
		input.actor.kind === "anonymous" &&
		input.ownerUserId === null &&
		normalizeLlmProvider(input.provider) === "openrouter"
	);
}

function openRouterSpendDenied(
	c: Context,
	access: { actor: RequestActor; playlist: PlaylistWire },
	provider = access.playlist.llmProvider,
): Response | null {
	const isOwnerlessProductionOpenRouter =
		process.env.NODE_ENV === "production" &&
		access.playlist.ownerUserId === null &&
		normalizeLlmProvider(provider) === "openrouter";
	if (!isOwnerlessProductionOpenRouter) {
		return null;
	}
	if (access.actor.kind === "user") {
		return c.json(
			{
				error:
					"Ownerless playlists cannot use OpenRouter in production; create an owned playlist instead",
			},
			409,
		);
	}
	return c.json(
		{ error: "Authentication is required to use the server OpenRouter key" },
		401,
	);
}

// ─── Queries ────────────────────────────────────────────────────────

// GET /api/playlists
app.get("/", async (c) => {
	const access = await getPlaybackAccess(c);
	return c.json(
		filterPlaybackAccessiblePlaylists(
			access,
			await playlistService.listAll(),
		).filter((playlist) => !isHiddenRadioPlaylist(playlist)),
	);
});

// GET /api/playlists/current
app.get("/current", async (c) => {
	const access = await getPlaybackAccess(c);
	const current =
		filterPlaybackAccessiblePlaylists(
			access,
			await playlistService.listActive(),
		)
			.filter(
				(playlist) =>
					playlist.mode !== "oneshot" && !isHiddenRadioPlaylist(playlist),
			)
			.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
	return c.json(current);
});

// GET /api/playlists/closed
app.get("/closed", async (c) => {
	const access = await getPlaybackAccess(c);
	return c.json(
		filterPlaybackAccessiblePlaylists(
			access,
			await playlistService.listClosed(),
		),
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
	const access = await getPlaybackAccess(c);
	const playlist = await playlistService.getByKey(c.req.param("key"));
	if (!playlist || !canPlaybackAccessPlaylist(access, playlist))
		return c.json(null, 404);
	return c.json(playlist);
});

// GET /api/playlists/:id
app.get("/:id", async (c) => {
	const access = await loadPlaybackAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	return c.json(access.playlist);
});

const ChatMessageSchema = z.object({
	content: z.string().min(1).max(MAX_HUMAN_CHAT_CONTENT_CHARS),
	threadId: z.string().nullable().optional(),
	commitDirection: z.boolean().optional(),
});

const ChatAnswerSchema = z.object({
	questionId: z.string().min(1),
	content: z.string().min(1).max(MAX_HUMAN_CHAT_CONTENT_CHARS),
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
app.post(
	"/:id/agent-chat/messages",
	llmLimiter,
	generationLimiter,
	async (c) => {
		const access = await loadAccessiblePlaylist(c);
		if (access instanceof Response) return access;
		const denied = openRouterSpendDenied(c, access);
		if (denied) return denied;
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
	},
);

// GET /api/playlists/:id/agent-chat/state
app.get("/:id/agent-chat/state", async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	return c.json(await getPlaylistChatState(c.req.param("id")));
});

// POST /api/playlists/:id/agent-chat/answer
app.post("/:id/agent-chat/answer", llmLimiter, async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const denied = openRouterSpendDenied(c, access);
	if (denied) return denied;
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
app.post("/", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = CreatePlaylistSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	if (
		result.data.mode === "radio" ||
		result.data.playlistKey === RADIO_PLAYLIST_KEY
	) {
		return c.json(
			{
				error: "Radio mode and key are reserved for the global server playlist",
			},
			400,
		);
	}
	const actor = await getRequestActor(c);
	const createPayload = { ...result.data };
	const initialDirectorPlan = createPayload.initialDirectorPlan === true;
	delete createPayload.initialDirectorPlan;

	if (createPayload.ownerUserId && actor.kind !== "user") {
		return c.json({ error: "ownerUserId requires authenticated user" }, 401);
	}
	if (
		requiresOpenRouterSpendAuthentication({
			actor,
			ownerUserId: null,
			provider: createPayload.llmProvider,
		})
	) {
		return c.json(
			{
				error: "Authentication is required to use the server OpenRouter key",
			},
			401,
		);
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
	const denied = openRouterSpendDenied(
		c,
		access,
		result.data.llmProvider ?? access.playlist.llmProvider,
	);
	if (denied) return denied;
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
	if (result.data.status !== "closed") {
		const denied = openRouterSpendDenied(c, access);
		if (denied) return denied;
	}
	await playlistService.updateStatus(c.req.param("id"), result.data.status);
	return c.json({ ok: true });
});

// PATCH /api/playlists/:id/position
app.patch("/:id/position", async (c) => {
	const access = await loadPlaybackAccessiblePlaylist(c);
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
app.patch("/:id/prompt", generationLimiter, async (c) => {
	const access = await loadAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const denied = openRouterSpendDenied(c, access);
	if (denied) return denied;
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
	const access = await loadPlaybackAccessiblePlaylist(c);
	if (access instanceof Response) return access;
	const denied = openRouterSpendDenied(c, access);
	if (denied) return denied;
	await playlistService.heartbeat(c.req.param("id"));
	return c.json({ ok: true });
});

export default app;
