import { Hono } from "hono";
import { codexAppServerClient } from "../external/codex-app-server-client";
import {
	cancelCodexDeviceAuth,
	getCodexDeviceAuthStatus,
	getCodexLoginStatus,
	startCodexDeviceAuth,
} from "../external/codex-auth";
import {
	enhancePlaylistPrompt,
	enhanceSessionParams,
	enhanceSongRequest,
	generatePersonaExtract,
	generateSongMetadata,
	getSongPromptContract,
	type PersonaInput,
	type PromptDistance,
	type PromptMode,
	type PromptProfile,
	refineSessionPrompt,
	type SongMetadata,
} from "../external/llm";
import { getServiceUrls, getSetting } from "../external/service-urls";
import { logger } from "../logger";

interface OllamaModel {
	name: string;
	size?: number;
	modified_at?: string;
	details?: { families?: string[] };
}

interface OpenRouterModel {
	id: string;
	name: string;
	pricing: { prompt: string; completion: string };
	context_length: number;
	architecture?: { modality?: string };
	output_modalities?: string[];
}

interface CodexModelResponse {
	id: string;
	displayName: string;
	inputModalities: string[];
	isDefault: boolean;
}

type AutoplayerProvider = "ollama" | "openrouter" | "openai-codex";

interface SourceSong {
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	mood?: string;
	energy?: string;
	era?: string;
	bpm?: number;
	keyScale?: string;
	vocalStyle?: string;
	instruments?: string[];
	themes?: string[];
	description?: string;
	lyrics?: string;
}

interface LikedSong {
	title: string;
	artistName: string;
	genre: string;
	mood?: string;
	vocalStyle?: string;
}

interface AlbumTrackRequest {
	playlistPrompt: string;
	provider: AutoplayerProvider;
	model: string;
	sourceSong: SourceSong;
	likedSongs?: LikedSong[];
	personaExtracts?: string[];
	avoidPersonaExtracts?: string[];
	previousAlbumTracks?: SongMetadata[];
	trackNumber: number;
	totalTracks: number;
	lyricsLanguage?: string;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
}

function parseProvider(value: unknown): AutoplayerProvider | undefined {
	if (
		value === "ollama" ||
		value === "openrouter" ||
		value === "openai-codex"
	) {
		return value;
	}
	return undefined;
}

function parsePromptDistance(value: unknown): PromptDistance | undefined {
	if (
		value === "close" ||
		value === "general" ||
		value === "faithful" ||
		value === "album"
	) {
		return value;
	}
	return undefined;
}

function parsePromptMode(value: unknown): PromptMode | undefined {
	if (value === "full" || value === "minimal" || value === "none") {
		return value;
	}
	return undefined;
}

function parsePromptProfile(value: unknown): PromptProfile | undefined {
	if (
		value === "strict" ||
		value === "balanced" ||
		value === "creative" ||
		value === "compact"
	) {
		return value;
	}
	return undefined;
}

function parseString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function parseOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function buildAlbumPrompt(req: AlbumTrackRequest): string {
	const lines: string[] = [];
	lines.push(`PLAYLIST CONTEXT: ${req.playlistPrompt}`);
	lines.push("");

	const source = req.sourceSong;
	lines.push("SOURCE SONG (the album is derived from this track):");
	lines.push(`  Title: "${source.title}" by ${source.artistName}`);
	lines.push(`  Genre: ${source.genre} / ${source.subGenre}`);
	if (source.mood) lines.push(`  Mood: ${source.mood}`);
	if (source.energy) lines.push(`  Energy: ${source.energy}`);
	if (source.era) lines.push(`  Era: ${source.era}`);
	if (source.bpm) lines.push(`  BPM: ${source.bpm}`);
	if (source.keyScale) lines.push(`  Key: ${source.keyScale}`);
	if (source.vocalStyle) lines.push(`  Vocal: ${source.vocalStyle}`);
	if (source.instruments?.length)
		lines.push(`  Instruments: ${source.instruments.join(", ")}`);
	if (source.themes?.length)
		lines.push(`  Themes: ${source.themes.join(", ")}`);
	if (source.description) lines.push(`  Description: ${source.description}`);
	if (source.lyrics)
		lines.push(`  Lyrics excerpt: ${source.lyrics.slice(0, 500)}`);
	lines.push("");

	if (req.personaExtracts?.length) {
		lines.push("LISTENER TASTE PROFILE (from liked songs this session):");
		for (const persona of req.personaExtracts) lines.push(`  - ${persona}`);
		lines.push(
			"These personas represent what the listener enjoys. Align album tracks with this taste profile.",
		);
		lines.push("");
	}

	if (req.avoidPersonaExtracts?.length) {
		lines.push("LISTENER DISLIKES (avoid these patterns):");
		for (const persona of req.avoidPersonaExtracts)
			lines.push(`  - ${persona}`);
		lines.push(
			"These represent what the listener does NOT enjoy. Steer away from these sonic and thematic patterns.",
		);
		lines.push("");
	}

	if (req.likedSongs?.length) {
		lines.push(
			"LIKED SONGS (listener preferences — use as additional flavor guidance):",
		);
		for (const song of req.likedSongs.slice(0, 10)) {
			const parts = [`"${song.title}" by ${song.artistName}`, song.genre];
			if (song.mood) parts.push(song.mood);
			if (song.vocalStyle) parts.push(song.vocalStyle);
			lines.push(`  - ${parts.join(" / ")}`);
		}
		lines.push("");
	}

	if (req.previousAlbumTracks?.length) {
		lines.push(
			"ALREADY GENERATED ALBUM TRACKS (create something DIFFERENT from these):",
		);
		for (const track of req.previousAlbumTracks) {
			lines.push(
				`  - "${track.title}" by ${track.artistName} — ${track.genre}/${track.subGenre}, ${track.mood}, ${track.energy} energy, ${track.vocalStyle}, BPM ${track.bpm}`,
			);
		}
		lines.push("");
	}

	const { trackNumber, totalTracks } = req;
	let positionHint = "Mid-album track — take creative risks within the genre.";
	if (trackNumber === 1) {
		positionHint =
			"This is the ALBUM OPENER — high energy, attention-grabbing, sets the tone.";
	} else if (trackNumber === totalTracks) {
		positionHint =
			"This is the ALBUM CLOSER — reflective, emotionally resonant, lasting impression.";
	} else if (trackNumber <= 3) {
		positionHint =
			"Early album track — build momentum and establish album identity.";
	} else if (trackNumber >= totalTracks - 2) {
		positionHint =
			"Late album track — wind down energy and prepare for the closing.";
	}
	lines.push(
		`TRACK POSITION: ${trackNumber} of ${totalTracks}. ${positionHint}`,
	);
	lines.push("");
	lines.push("Generate a new album track now.");

	return lines.join("\n");
}

const app = new Hono();

// ─── Legacy audio URL redirect ──────────────────────────────────────
app.get("/audio/:id", (c) => {
	return c.redirect(`/api/songs/${c.req.param("id")}/audio`, 301);
});

// ─── GET /ollama-models ─────────────────────────────────────────────
app.get("/ollama-models", async (c) => {
	try {
		const urls = await getServiceUrls();
		const response = await fetch(`${urls.ollamaUrl}/api/tags`, {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			return c.json(
				{ error: `Ollama returned ${response.status}`, models: [] },
				502,
			);
		}
		const data = (await response.json()) as { models?: OllamaModel[] };

		const models = (data.models || []).map((m: OllamaModel) => {
			const families: string[] = m.details?.families || [];
			const nameLower = m.name.toLowerCase();
			const isVision =
				families.some(
					(f: string) => f.includes("clip") || f.toLowerCase().includes("vl"),
				) ||
				nameLower.includes("vl") ||
				nameLower.includes("llava") ||
				nameLower.includes("vision");
			const isEmbedding =
				families.some((f: string) => f.includes("bert")) ||
				nameLower.includes("embed");
			const isOcr = nameLower.includes("ocr");

			let type = "text";
			if (isEmbedding) type = "embedding";
			else if (isVision || isOcr) type = "vision";

			return {
				name: m.name,
				size: m.size,
				modifiedAt: m.modified_at,
				vision: isVision || isOcr,
				type,
			};
		});

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch Ollama models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch Ollama models",
				models: [],
			},
			500,
		);
	}
});

// ─── GET /ace-models ────────────────────────────────────────────────
app.get("/ace-models", async (c) => {
	try {
		const urls = await getServiceUrls();
		const response = await fetch(`${urls.aceStepUrl}/v1/models`, {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			return c.json(
				{ error: `ACE-Step returned ${response.status}`, models: [] },
				502,
			);
		}
		const data = (await response.json()) as {
			data?: { id?: string; name?: string }[];
			models?: { id?: string; name?: string }[];
		};

		const rawModels = data.data || data.models || [];
		const models = rawModels.map((m: { id?: string; name?: string }) => ({
			name: m.id || m.name || "unknown",
			is_default: rawModels.length === 1,
		}));

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch ACE-Step models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch ACE-Step models",
				models: [],
			},
			500,
		);
	}
});

// ─── GET /openrouter-models?type=text|image ─────────────────────────
app.get("/openrouter-models", async (c) => {
	try {
		const type = c.req.query("type") || "text";

		const apiKey = await getSetting("openrouterApiKey");
		if (!apiKey) {
			return c.json(
				{ error: "No OpenRouter API key configured", models: [] },
				400,
			);
		}

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return c.json(
				{ error: `OpenRouter returned ${response.status}`, models: [] },
				502,
			);
		}

		const data = (await response.json()) as { data?: OpenRouterModel[] };
		const allModels: OpenRouterModel[] = data.data || [];

		let filtered: typeof allModels;
		if (type === "image") {
			filtered = allModels.filter(
				(m) =>
					m.output_modalities?.includes("image") ||
					m.architecture?.modality === "text->image",
			);
		} else {
			filtered = allModels.filter(
				(m) =>
					m.architecture?.modality === "text->text" ||
					m.architecture?.modality === "text+image->text",
			);
		}

		const models = filtered.map((m) => ({
			id: m.id,
			name: m.name,
			promptPrice: m.pricing.prompt,
			completionPrice: m.pricing.completion,
			contextLength: m.context_length,
		}));

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch OpenRouter models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch OpenRouter models",
				models: [],
			},
			500,
		);
	}
});

// ─── GET /prompt-contract?distance=close|general|faithful|album ─────
app.get("/prompt-contract", async (c) => {
	try {
		const distance = parsePromptDistance(c.req.query("distance")) ?? "close";
		const profile = parsePromptProfile(c.req.query("profile"));
		const mode = parsePromptMode(c.req.query("mode"));
		return c.json(getSongPromptContract(distance, profile, mode));
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to build prompt contract");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to build prompt contract",
			},
			500,
		);
	}
});

// ─── POST /generate-song ─────────────────────────────────────────────
app.post("/generate-song", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const prompt = parseString(body.prompt) || parseString(body.userPrompt);
		if (!provider || !prompt) {
			return c.json(
				{
					error: "Missing required fields: provider, prompt",
				},
				400,
			);
		}

		const songData = await generateSongMetadata({
			prompt,
			provider,
			model,
			lyricsLanguage: parseOptionalString(body.lyricsLanguage),
			managerBrief: parseOptionalString(body.managerBrief),
			managerTransitionPolicy: parseOptionalString(
				body.managerTransitionPolicy,
			),
			managerSlot:
				typeof body.managerSlot === "object" && body.managerSlot !== null
					? (body.managerSlot as {
							slot: number;
							transitionIntent: string;
							topicHint: string;
							captionFocus: string;
							lyricTheme: string;
							energyTarget: "low" | "medium" | "high" | "extreme";
						})
					: undefined,
			targetBpm: parseOptionalNumber(body.targetBpm),
			targetKey: parseOptionalString(body.targetKey),
			timeSignature: parseOptionalString(body.timeSignature),
			audioDuration: parseOptionalNumber(body.audioDuration),
			recentSongs: Array.isArray(body.recentSongs)
				? (body.recentSongs as {
						title: string;
						artistName: string;
						genre: string;
						subGenre: string;
						vocalStyle?: string;
						mood?: string;
						energy?: string;
					}[])
				: undefined,
			recentDescriptions: Array.isArray(body.recentDescriptions)
				? (body.recentDescriptions as string[])
				: undefined,
			isInterrupt: body.isInterrupt === true,
			promptDistance: parsePromptDistance(body.promptDistance),
			promptProfile: parsePromptProfile(body.promptProfile),
			promptMode: parsePromptMode(body.promptMode),
		});
		return c.json(songData);
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to generate song metadata");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to generate song metadata",
			},
			500,
		);
	}
});

// ─── POST /generate-album-track ──────────────────────────────────────
app.post("/generate-album-track", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const playlistPrompt = parseString(body.playlistPrompt);
		const sourceSong = body.sourceSong as SourceSong | undefined;
		const trackNumber = parseOptionalNumber(body.trackNumber);
		const totalTracks = parseOptionalNumber(body.totalTracks);
		if (
			!provider ||
			!playlistPrompt ||
			!sourceSong?.title ||
			!sourceSong.artistName ||
			!sourceSong.genre ||
			!sourceSong.subGenre ||
			!trackNumber ||
			!totalTracks
		) {
			return c.json(
				{
					error:
						"Missing required fields: playlistPrompt, provider, sourceSong, trackNumber, totalTracks",
				},
				400,
			);
		}

		const request: AlbumTrackRequest = {
			playlistPrompt,
			provider,
			model,
			sourceSong,
			likedSongs: Array.isArray(body.likedSongs)
				? (body.likedSongs as LikedSong[])
				: undefined,
			personaExtracts: Array.isArray(body.personaExtracts)
				? (body.personaExtracts as string[])
				: undefined,
			avoidPersonaExtracts: Array.isArray(body.avoidPersonaExtracts)
				? (body.avoidPersonaExtracts as string[])
				: undefined,
			previousAlbumTracks: Array.isArray(body.previousAlbumTracks)
				? (body.previousAlbumTracks as SongMetadata[])
				: undefined,
			trackNumber,
			totalTracks,
			lyricsLanguage: parseOptionalString(body.lyricsLanguage),
			targetKey: parseOptionalString(body.targetKey),
			timeSignature: parseOptionalString(body.timeSignature),
			audioDuration: parseOptionalNumber(body.audioDuration),
		};

		const songData = await generateSongMetadata({
			prompt: buildAlbumPrompt(request),
			promptDistance: "album",
			provider,
			model,
			lyricsLanguage: request.lyricsLanguage,
			targetKey: request.targetKey,
			timeSignature: request.timeSignature,
			audioDuration: request.audioDuration,
			promptProfile: parsePromptProfile(body.promptProfile),
			promptMode: parsePromptMode(body.promptMode),
		});
		return c.json(songData);
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to generate album track");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to generate album track",
			},
			500,
		);
	}
});

// ─── POST /extract-persona ───────────────────────────────────────────
app.post("/extract-persona", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const song =
			typeof body.song === "object" && body.song !== null
				? (body.song as PersonaInput)
				: undefined;
		if (!provider || !song) {
			return c.json(
				{
					error: "Missing required fields: song, provider",
				},
				400,
			);
		}
		const persona = await generatePersonaExtract({
			song,
			provider,
			model,
		});
		return c.json({ persona });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to extract persona");
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to extract persona",
			},
			500,
		);
	}
});

// ─── POST /enhance-prompt ────────────────────────────────────────────
app.post("/enhance-prompt", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const prompt = parseString(body.prompt);
		if (!provider || !prompt) {
			return c.json(
				{ error: "Missing required fields: prompt, provider" },
				400,
			);
		}
		const result = await enhancePlaylistPrompt({
			prompt,
			provider,
			model,
		});
		return c.json({ result });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to enhance prompt");
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to enhance prompt",
			},
			500,
		);
	}
});

// ─── POST /enhance-request ───────────────────────────────────────────
app.post("/enhance-request", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const request = parseString(body.request);
		if (!provider || !request) {
			return c.json(
				{ error: "Missing required fields: request, provider" },
				400,
			);
		}
		const result = await enhanceSongRequest({
			request,
			provider,
			model,
		});
		return c.json({ result });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to enhance request");
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to enhance request",
			},
			500,
		);
	}
});

// ─── POST /refine-prompt ─────────────────────────────────────────────
app.post("/refine-prompt", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const currentPrompt = parseString(body.currentPrompt);
		const direction = parseString(body.direction);
		if (!provider || !currentPrompt || !direction) {
			return c.json(
				{
					error: "Missing required fields: currentPrompt, direction, provider",
				},
				400,
			);
		}
		const result = await refineSessionPrompt({
			currentPrompt,
			direction,
			provider,
			model,
		});
		return c.json({ result });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to refine prompt");
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "Failed to refine prompt",
			},
			500,
		);
	}
});

// ─── POST /enhance-session ───────────────────────────────────────────
app.post("/enhance-session", async (c) => {
	try {
		const body = await c.req.json<Record<string, unknown>>();
		const provider = parseProvider(body.provider);
		const model = parseString(body.model);
		const prompt = parseString(body.prompt);
		if (!provider || !prompt) {
			return c.json(
				{
					error: "Missing required fields: prompt, provider",
				},
				400,
			);
		}
		const params = await enhanceSessionParams({
			prompt,
			provider,
			model,
		});
		return c.json(params);
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to enhance session params");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to analyze session params",
			},
			500,
		);
	}
});

// ─── GET /codex-models ──────────────────────────────────────────────
app.get("/codex-models", async (c) => {
	try {
		const account = await codexAppServerClient.readAccount();
		if (!account.account || account.account.type !== "chatgpt") {
			return c.json(
				{
					error:
						"OpenAI Codex requires ChatGPT login. Start device auth in Settings.",
					models: [],
				},
				401,
			);
		}

		const modelList = await codexAppServerClient.listModels();
		const models = modelList.map((m: CodexModelResponse) => ({
			name: m.id,
			displayName: m.displayName,
			type: m.inputModalities.includes("text") ? "text" : "unknown",
			inputModalities: m.inputModalities,
			is_default: m.isDefault,
		}));

		return c.json({
			models,
			account: {
				type: account.account.type,
				email: account.account.email,
				planType: account.account.planType,
			},
		});
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch Codex models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch Codex models",
				models: [],
			},
			500,
		);
	}
});

// ─── POST /codex/text ───────────────────────────────────────────────
app.post("/codex/text", async (c) => {
	try {
		const body = await c.req.json<{
			model?: string;
			system?: string;
			prompt?: string;
		}>();
		if (!body.model || !body.system || !body.prompt) {
			return c.json(
				{
					error: "Missing required fields: model, system, prompt",
				},
				400,
			);
		}

		const text = await codexAppServerClient.generateText({
			model: body.model,
			system: body.system,
			prompt: body.prompt,
		});
		return c.json({ text });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Codex text generation failed");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Codex text generation failed",
			},
			500,
		);
	}
});

// ─── POST /codex/object ─────────────────────────────────────────────
app.post("/codex/object", async (c) => {
	try {
		const body = await c.req.json<{
			model?: string;
			system?: string;
			prompt?: string;
			schema?: Record<string, unknown>;
		}>();
		if (!body.model || !body.system || !body.prompt || !body.schema) {
			return c.json(
				{
					error: "Missing required fields: model, system, prompt, schema",
				},
				400,
			);
		}
		if (typeof body.schema !== "object" || Array.isArray(body.schema)) {
			return c.json({ error: "Schema must be a JSON object" }, 400);
		}

		const object = await codexAppServerClient.generateJson({
			model: body.model,
			system: body.system,
			prompt: body.prompt,
			outputSchema: body.schema,
		});
		return c.json({ object });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Codex object generation failed");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Codex object generation failed",
			},
			500,
		);
	}
});

// ─── POST /codex-auth/start ─────────────────────────────────────────
app.post("/codex-auth/start", async (c) => {
	try {
		const session = await startCodexDeviceAuth();
		return c.json({ session });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to start Codex device auth");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to start Codex device auth",
			},
			500,
		);
	}
});

// ─── GET /codex-auth/status ────────────────────────────────────────
app.get("/codex-auth/status", async (c) => {
	try {
		const session = getCodexDeviceAuthStatus();
		const loginStatus = await getCodexLoginStatus();
		return c.json({ session, loginStatus });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to read Codex auth status");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to read Codex auth status",
			},
			500,
		);
	}
});

// ─── POST /codex-auth/cancel ───────────────────────────────────────
app.post("/codex-auth/cancel", async (c) => {
	try {
		let sessionId: string | undefined;
		try {
			const body = await c.req.json<{ sessionId?: string }>();
			sessionId = body.sessionId;
		} catch {
			// No body provided; cancel current session.
		}

		const session = cancelCodexDeviceAuth(sessionId);
		return c.json({ session });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to cancel Codex device auth");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to cancel Codex device auth",
			},
			500,
		);
	}
});

// ─── POST /test-connection ──────────────────────────────────────────
app.post("/test-connection", async (c) => {
	try {
		const body = await c.req.json<{ provider: string; apiKey?: string }>();
		const { provider, apiKey } = body;
		if (!provider || typeof provider !== "string") {
			return c.json(
				{ ok: false, error: "Missing required field: provider" },
				400,
			);
		}
		const urls = await getServiceUrls();

		if (provider === "ollama") {
			const response = await fetch(`${urls.ollamaUrl}/api/tags`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "ollama", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `Ollama returned ${response.status}`,
				});
			}
			const data = (await response.json()) as { models?: unknown[] };
			const count = data.models?.length ?? 0;
			return c.json({
				ok: true,
				message: `Connected — ${count} models available`,
			});
		}

		if (provider === "openrouter") {
			if (!apiKey) {
				return c.json({ ok: false, error: "No API key provided" });
			}
			const response = await fetch("https://openrouter.ai/api/v1/models", {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "openrouter", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `OpenRouter returned ${response.status}`,
				});
			}
			return c.json({ ok: true, message: "Connected to OpenRouter" });
		}

		if (provider === "openai-codex") {
			const account = await codexAppServerClient.readAccount();
			if (!account.account || account.account.type !== "chatgpt") {
				return c.json({
					ok: false,
					error:
						"Not authenticated with ChatGPT. Start Codex device auth in Settings.",
				});
			}
			const models = await codexAppServerClient.listModels();
			return c.json({
				ok: true,
				message: `Connected — ${models.length} model(s) (${account.account.planType ?? "chatgpt"})`,
			});
		}

		if (provider === "comfyui") {
			const response = await fetch(`${urls.comfyuiUrl}/system_stats`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "comfyui", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `ComfyUI returned ${response.status}`,
				});
			}
			return c.json({ ok: true, message: "Connected to ComfyUI" });
		}

		if (provider === "ace-step") {
			const response = await fetch(`${urls.aceStepUrl}/v1/models`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "ace-step", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `ACE-Step returned ${response.status}`,
				});
			}
			const data = (await response.json()) as { data?: unknown[] };
			const models = data.data || [];
			return c.json({
				ok: true,
				message: `Connected — ${models.length} model(s)`,
			});
		}

		return c.json({ ok: false, error: `Unknown provider: ${provider}` }, 400);
	} catch (error: unknown) {
		const message =
			error instanceof Error && error.name === "TimeoutError"
				? "Connection timed out"
				: error instanceof Error
					? error.message
					: "Connection failed";
		return c.json({ ok: false, error: message }, 500);
	}
});

export default app;
