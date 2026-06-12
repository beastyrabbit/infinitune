import {
	CompleteSongMetadataSchema,
	CreatePendingSongSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import z from "zod";
import * as playlistService from "../../services/playlist-service";
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

const ONESHOT_PLAYLIST_TTL_MS = 24 * 60 * 60 * 1000;

const OneshotRawSchema = z.object({
	lyrics: z.string().min(1).max(20000),
	style: z.string().max(1000).optional().default(""),
	audioDuration: z.number().min(10).max(600).optional().default(180),
	playlistKey: z.string().min(1).max(64).optional(),
});

function deriveOneshotTitle(lyrics: string): string {
	for (const rawLine of lyrics.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("[")) continue;
		return line.length > 60 ? `${line.slice(0, 57)}...` : line;
	}
	return "Untitled";
}

// POST /api/songs/oneshot-raw — playlist + metadata_ready song in one call.
// Text goes straight to ACE-Step with zero LLM processing. The playlist is
// created without emitting playlist.created until the song row exists, so the
// worker's oneshot buffer check never auto-creates a pending (LLM) song.
app.post("/oneshot-raw", async (c) => {
	const body = await c.req.json();
	const result = OneshotRawSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { lyrics, style, audioDuration, playlistKey } = result.data;

	const title = deriveOneshotTitle(lyrics);
	const genre = style.split(",")[0]?.trim() || "electronic";

	const playlist = await playlistService.create({
		name: `[RAW] ${title}`,
		prompt: style || title,
		llmProvider: "openai-codex",
		llmModel: "",
		mode: "oneshot",
		playlistKey,
		audioDuration,
		// User picked an explicit duration — never let ACE auto-detect (-1)
		aceAutoDuration: false,
		isTemporary: true,
		expiresAt: Date.now() + ONESHOT_PLAYLIST_TTL_MS,
		emitCreated: false,
	});

	const song = await songService.createWithMetadata(playlist.id, 1, {
		title,
		artistName: "Oneshot",
		genre,
		subGenre: genre,
		lyrics,
		caption: style,
		bpm: 120,
		keyScale: "C major",
		timeSignature: "4/4",
		audioDuration,
	});

	playlistService.announceCreated(playlist.id);

	return c.json({ playlist, song });
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
