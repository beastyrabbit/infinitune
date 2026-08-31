import {
	CompleteSongMetadataSchema,
	CreatePendingSongSchema,
} from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import z from "zod";
import { getRequestActor, type RequestActor } from "../../auth/actor";
import { downloadYoutubeAudio } from "../../external/youtube-audio";
import { generationLimiter } from "../../middleware/limiters";
import * as playlistService from "../../services/playlist-service";
import * as songService from "../../services/song-service";
import { resolveSongAudioFile } from "../../utils/song-audio-path";
import { canActorAccessPlaylist } from "./access";

const app = new Hono();

function ownerFields(actor: RequestActor): { ownerUserId?: string } {
	return actor.kind === "user" ? { ownerUserId: actor.userId } : {};
}

const CreateWithMetadataSchema = CompleteSongMetadataSchema.extend({
	playlistId: CreatePendingSongSchema.shape.playlistId,
	orderIndex: CreatePendingSongSchema.shape.orderIndex,
	promptEpoch: CreatePendingSongSchema.shape.promptEpoch,
});

// POST /api/songs — create a song with full metadata (status=generating_metadata)
app.post("/", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = CreateWithMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...metadata } = result.data;
	const actor = await getRequestActor(c);
	if (!(await canActorAccessPlaylist(actor, playlistId))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	return c.json(
		await songService.createWithMetadata(playlistId, orderIndex, metadata),
	);
});

// POST /api/songs/create-pending — create a pending song
app.post("/create-pending", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = CreatePendingSongSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...opts } = result.data;
	const actor = await getRequestActor(c);
	if (!(await canActorAccessPlaylist(actor, playlistId))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
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
app.post("/oneshot-raw", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = OneshotRawSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { lyrics, style, audioDuration, playlistKey } = result.data;
	const actor = await getRequestActor(c);

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
		...ownerFields(actor),
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

const ReimagineSchema = z.object({
	sourceSongId: z.string().min(1),
	style: z.string().min(1).max(1000),
	/** 0 = loose interpretation, 1 = closest to the source audio */
	coverNoiseStrength: z.number().min(0).max(1).optional().default(0.5),
	playlistKey: z.string().min(1).max(64).optional(),
});

// POST /api/songs/reimagine — re-render an existing song in a new style via
// the ACE "cover" task. The source song's audio is uploaded as the reference,
// so structure/melody stay recognizable while the style follows the prompt.
app.post("/reimagine", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = ReimagineSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { sourceSongId, style, coverNoiseStrength, playlistKey } = result.data;
	const actor = await getRequestActor(c);

	const source = await songService.getById(sourceSongId);
	if (!source || !(await canActorAccessPlaylist(actor, source.playlistId))) {
		return c.json({ error: "Source song not found" }, 404);
	}
	if (!resolveSongAudioFile(source.storagePath)) {
		return c.json({ error: "Source song audio is not available" }, 400);
	}

	const title = `${source.title || "Untitled"} (Reimagined)`;
	const genre = style.split(",")[0]?.trim() || source.genre || "electronic";
	const audioDuration = source.audioDuration ?? 180;

	const playlist = await playlistService.create({
		name: `[REIMAGINE] ${title}`,
		prompt: style,
		llmProvider: "openai-codex",
		llmModel: "",
		mode: "oneshot",
		playlistKey,
		audioDuration,
		// Match the source duration exactly — never let ACE auto-detect (-1)
		aceAutoDuration: false,
		isTemporary: true,
		expiresAt: Date.now() + ONESHOT_PLAYLIST_TTL_MS,
		emitCreated: false,
		...ownerFields(actor),
	});

	const song = await songService.createWithMetadata(
		playlist.id,
		1,
		{
			title,
			artistName: source.artistName || "Reimagined",
			genre,
			subGenre: genre,
			lyrics: source.lyrics || "",
			caption: style,
			bpm: source.bpm || 120,
			keyScale: source.keyScale || "C major",
			timeSignature: source.timeSignature || "4/4",
			audioDuration,
		},
		{
			aceTaskType: "cover",
			sourceSongId,
			coverNoiseStrength,
		},
	);

	playlistService.announceCreated(playlist.id);

	return c.json({ playlist, song });
});

const ReimagineUrlSchema = z.object({
	url: z.string().url().max(500),
	style: z.string().min(1).max(1000),
	lyrics: z.string().max(20000).optional().default(""),
	coverNoiseStrength: z.number().min(0).max(1).optional().default(0.5),
	playlistKey: z.string().min(1).max(64).optional(),
});

// POST /api/songs/reimagine-url — reimagine an external source (YouTube etc.):
// yt-dlp downloads the audio, which then drives the ACE cover task. Lyrics
// can't be extracted from the source, so the caller supplies them (optional).
app.post("/reimagine-url", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = ReimagineUrlSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { url, style, lyrics, coverNoiseStrength, playlistKey } = result.data;
	const actor = await getRequestActor(c);

	let download: Awaited<ReturnType<typeof downloadYoutubeAudio>>;
	try {
		download = await downloadYoutubeAudio(url);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Download failed";
		return c.json({ error: `Could not fetch source audio: ${message}` }, 400);
	}

	const title = `${download.title} (Reimagined)`;
	const genre = style.split(",")[0]?.trim() || "electronic";
	const audioDuration = Math.round(download.durationSeconds);

	const playlist = await playlistService.create({
		name: `[REIMAGINE] ${title}`,
		prompt: style,
		llmProvider: "openai-codex",
		llmModel: "",
		mode: "oneshot",
		playlistKey,
		audioDuration,
		aceAutoDuration: false,
		isTemporary: true,
		expiresAt: Date.now() + ONESHOT_PLAYLIST_TTL_MS,
		emitCreated: false,
		...ownerFields(actor),
	});

	const song = await songService.createWithMetadata(
		playlist.id,
		1,
		{
			title,
			artistName: "Reimagined",
			genre,
			subGenre: genre,
			lyrics,
			caption: style,
			bpm: 120,
			keyScale: "C major",
			timeSignature: "4/4",
			audioDuration,
		},
		{
			aceTaskType: "cover",
			sourceAudioPath: download.filePath,
			coverNoiseStrength,
		},
	);

	playlistService.announceCreated(playlist.id);

	return c.json({ playlist, song });
});

// POST /api/songs/create-metadata-ready — create with metadata already done
app.post("/create-metadata-ready", generationLimiter, async (c) => {
	const body = await c.req.json();
	const result = CreateWithMetadataSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	const { playlistId, orderIndex, ...metadata } = result.data;
	const actor = await getRequestActor(c);
	if (!(await canActorAccessPlaylist(actor, playlistId))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	return c.json(
		await songService.createWithMetadata(playlistId, orderIndex, metadata),
	);
});

export default app;
