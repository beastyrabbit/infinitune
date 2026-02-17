import { normalizeLyricsLanguage } from "@infinitune/shared/lyrics-language";
import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import z from "zod";
import { callLlmObject } from "@/services/llm-client";

/** Shared field guidance used across all prompt modes */
const FIELD_GUIDANCE = `Your response must conform to the provided JSON schema. Fill in every field.

Field guidance:
- title: A creative, evocative song title
- artistName: A fictional artist/band name that fits the genre (never use real artist names)
- genre: Broad category (e.g. Rock, Electronic, Hip-Hop, Jazz, Pop, Metal, R&B, Country, Classical)
- subGenre: Specific sub-genre (e.g. Synthwave, Acid Jazz, Lo-Fi Hip-Hop, Shoegaze, Post-Punk)
- vocalStyle: Describe the vocal performance for the AI audio generator. Format: gender + vocal quality + performance style.
  Gender: male, female, duet (male+female), choir, androgynous
  Vocal quality: breathy, raspy, powerful, smooth, falsetto, gritty, husky, crystalline, airy, warm, nasal, operatic, whispered
  Performance style: soulful, energetic, intimate, passionate, anthemic, laid-back, aggressive, dreamy, playful, melancholic, defiant, tender
  Examples: "female breathy intimate vocal", "male raspy energetic vocal", "duet smooth passionate vocals", "choir powerful anthemic vocals"
- lyrics: Complete song lyrics. The WRITING QUALITY is critical — these must read like real songwriting, not AI filler.
  WRITING STYLE (adapt to genre):
  - Match the lyrical tradition of the genre. Prog rock = poetic, abstract. Hip-hop = wordplay, flow. Country = storytelling, concrete imagery. Pop = hooky, emotionally direct. Jazz = impressionistic. Punk = raw. Folk = narrative.
  - Use SPECIFIC imagery over vague abstractions. BAD: 'the pain inside my heart'. GOOD: 'fingerprints still on the glass where you leaned that morning'.
  - Vary rhyme density by genre. Do NOT force rhymes at the expense of naturalness.
  - Vary line length and pacing. Let some lines breathe.
  STRUCTURE (use section tags for the AI audio generator):
  Section tags with ONE style hint: [Verse 1 - intimate], [Chorus - anthemic], [Bridge - whispered], [Outro - fading]
  Instrumental sections: [Guitar Solo], [Piano Interlude], [Synth Breakdown], [Drum Break]
  Dynamic markers: [Build], [Drop], [Breakdown], [Crescendo]
  Background vocals in parentheses: (ooh, aah), (harmonizing: we'll find our way)
  Use UPPERCASE for emotional intensity: "I will NOT surrender"
  Include at least one instrumental section. Aim for 6-10 syllables per line for vocal clarity.
  IMPORTANT: Instruments mentioned in the caption MUST appear as instrumental tags in the lyrics.
  Keep tags concise (max one style hint in each section tag).
  If the track should be instrumental, use [Instrumental] instead of sung lyrics.
- caption: Audio generation prompt. Structure: [genre/style], [2-4 specific instruments], [texture/production words], [mood]. Do NOT include vocal info, BPM, key, or duration — those go in dedicated fields. Max 300 chars.
  Examples: "shoegaze, shimmering reverb guitars, droning Juno-60 pads, tight snare, warm tape saturation, hazy and melancholic"
  "lo-fi hip-hop, dusty SP-404 samples, muted Rhodes, vinyl crackle, boom-bap drums, late-night contemplative"
  Caption and lyrics tags must never conflict on instruments, mood, or performance direction.
- coverPrompt: A HIGHLY DETAILED art description for the image printed on this song's CD. Do NOT include "CD disc artwork" or similar framing — that is added automatically. Just describe the art itself. Max 600 chars.
  RULES:
  1. ART STYLE — Pick ONE at random. Vary art styles across songs: expired Polaroid photo, Soviet propaganda poster, ukiyo-e woodblock print, 1970s prog rock airbrush, Alphonse Mucha art nouveau, Bauhaus geometric poster, cyberpunk manga panel, Renaissance fresco fragment, 35mm Kodachrome slide, risograph zine print, Persian miniature painting, pixel art scene, chalk pastel on black paper, oil painting with visible palette knife strokes, cyanotype botanical print, 1920s Art Deco poster, VHS screen capture, stained glass window, watercolor bleed on wet paper, double exposure film photograph, linocut print, glitch art corruption, daguerreotype portrait, neon sign in fog, collage of torn magazine pages, spray paint stencil on brick wall, Dutch Golden Age still life, Chinese ink wash painting, cross-processed 35mm film, Aboriginal dot painting, 1950s pulp sci-fi cover, solarized darkroom print
  2. SCENE — A SPECIFIC, vivid scene inspired by THIS song's lyrics. Describe exact objects, materials, textures, spatial relationships. BAD: "a woman standing in rain". GOOD: "a woman in a moth-eaten velvet coat standing ankle-deep in a flooded ballroom, chandelier reflections rippling across the black water surface".
  3. MATERIALS & TEXTURES — Specify physical qualities: "cracked leather", "oxidized copper patina", "rain-streaked glass".
  4. LIGHTING — Be precise: "harsh tungsten overhead casting deep eye-socket shadows", "golden hour backlighting through dusty air".
  5. SURREAL ELEMENT — ONE unexpected detail: a clock melting over a fire escape, butterflies made of sheet music.
  6. COLOR PALETTE — Name 3-5 SPECIFIC pigment colors: "raw umber, viridian green, cadmium red deep" — NOT "warm earth tones".
  7. COMPOSITION — Design for CIRCULAR framing: radial symmetry, centered subjects, spiral patterns.
  8. NEVER include text, words, letters, typography, logos, or band/song names.
- bpm: Beats per minute appropriate for the genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for drum & bass)
- keyScale: Musical key (e.g. "C major", "A minor", "F# minor", "Bb major")
- timeSignature: Time signature (usually "4/4", but "3/4" for waltzes, "6/8" for compound time, etc.)
- audioDuration: Length in seconds, between 180 and 300 (3-5 minutes)
- mood: The dominant emotional mood. Pick ONE from: euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic, romantic, anxious, triumphant, serene, mysterious, rebellious, bittersweet, whimsical, haunting, empowering, contemplative, chaotic
- energy: Energy level. One of: low, medium, high, extreme
- era: Musical era/decade: 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s, timeless, futuristic
- instruments: Array of 3-5 specific instruments. "Fender Rhodes", not "keyboard". "TR-808 drum machine", not "drums".
- tags: Array of 3-5 searchable tags mixing atmosphere, use case, and sonic quality.
- themes: Array of 2-3 lyrical themes.
- language: Language of the lyrics. e.g. "English", "German", "Mixed (English/Spanish)"
- description: Short 1-2 sentence music journalist description. Max 200 chars.

JSON OUTPUT: All newlines in lyrics must be escaped as \\n. Output must be valid JSON.`;

/** Close prompt — stays near the playlist theme, like a radio station that stays on-brand */
const SYSTEM_PROMPT_CLOSE = `You are a music producer AI. Generate a song that fits naturally in this playlist.

Stay in the same genre family, similar era and vibe. Like a radio station that stays on-brand — same world, different song. Use a different title, different lyrics, different specific instruments, but the overall feel should be cohesive with the playlist theme.

${FIELD_GUIDANCE}`;

/** General prompt — explores further, like a DJ who plays something unexpected but it still works */
const SYSTEM_PROMPT_GENERAL = `You are a music producer AI. Generate a song inspired by this playlist's theme but from a different angle.

Pick an adjacent genre, shift the mood, change the energy level, try a different era. Like a DJ who plays something unexpected but it still works in the set. The playlist theme is your starting point — venture outward from it. Explore the full musical spectrum while keeping a thread of connection to the original vibe.

${FIELD_GUIDANCE}`;

/** Faithful prompt — for specific user requests (interrupts), follow exactly what was asked */
const SYSTEM_PROMPT_FAITHFUL = `You are a music producer AI. This is a SPECIFIC user request — follow it exactly.

Be creative within the bounds of what was asked. If they say "German cover of Bohemian Rhapsody", make exactly that. If they say "chill lo-fi beat", make exactly that. Do not explore adjacent genres or add unexpected twists — deliver what was requested with high quality and attention to detail.

${FIELD_GUIDANCE}`;

/** Album prompt — creates album tracks derived from a source song */
const SYSTEM_PROMPT_ALBUM = `You are a music producer AI creating a track for a cohesive album.

All tracks on this album share the same genre family, production aesthetic, and thematic world as the source song. But each track must be its OWN song — unique title, unique fictional artist name, unique lyrical angle, unique vocal style.

ALBUM RULES:
- Stay in the SAME genre family as the source song. Do NOT cross genre boundaries (no jazz track on a metal album).
- Vary energy levels across tracks: some high, some low, some medium.
- Vary mood: not every track should have the same emotional tone.
- Vary tempo: shift BPM within the genre's natural range.
- Vary vocal style: different gender, different vocal quality, different performance energy.
- Each new track must differ from previously generated tracks in at least 3 dimensions (mood, energy, tempo, vocal style, lyrical theme, instruments).
- Production aesthetic should feel cohesive — same "studio" / "producer" vibe across all tracks.

${FIELD_GUIDANCE}`;

export type PromptDistance = "close" | "general" | "faithful" | "album";

/** Pick which system prompt to use based on mode */
function getSystemPrompt(distance: PromptDistance): string {
	switch (distance) {
		case "faithful":
			return SYSTEM_PROMPT_FAITHFUL;
		case "general":
			return SYSTEM_PROMPT_GENERAL;
		case "album":
			return SYSTEM_PROMPT_ALBUM;
		default:
			return SYSTEM_PROMPT_CLOSE;
	}
}

/** Default system prompt (close distance) — used by testlab debug views */
const SYSTEM_PROMPT = SYSTEM_PROMPT_CLOSE;

const SONG_SCHEMA = {
	type: "object" as const,
	properties: {
		title: { type: "string", description: "Song title" },
		artistName: { type: "string", description: "Fictional artist name" },
		genre: { type: "string", description: "Main genre" },
		subGenre: { type: "string", description: "Specific sub-genre" },
		vocalStyle: {
			type: "string",
			description:
				'Vocal description: gender + quality + style, e.g. "female breathy intimate vocal"',
		},
		lyrics: {
			type: "string",
			description:
				"Full song lyrics with rich section tags like [Verse 1 - intimate], [Chorus - anthemic], instrumental sections, and dynamic markers",
		},
		caption: {
			type: "string",
			description:
				"Audio generation caption: [genre/style], [2-4 specific instruments], [texture/production words], [mood]. No vocals, BPM, key, or duration. Max 300 chars.",
		},
		coverPrompt: {
			type: "string",
			description:
				"Art description only — do NOT include CD/disc framing (added automatically). Include: art style from pool, cinematic scene with specific materials/textures, spatial depth, surreal element, precise lighting, exact pigment color palette. Circular composition. No text/typography. Max 600 chars.",
		},
		bpm: { type: "number", description: "Beats per minute (60-200)" },
		keyScale: { type: "string", description: 'Musical key, e.g. "C major"' },
		timeSignature: {
			type: "string",
			description: 'Time signature, e.g. "4/4"',
		},
		audioDuration: {
			type: "number",
			description: "Duration in seconds (180-300)",
		},
		mood: {
			type: "string",
			description:
				"Dominant mood: euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic, romantic, anxious, triumphant, serene, mysterious, rebellious, bittersweet, whimsical, haunting, empowering, contemplative, chaotic",
		},
		energy: {
			type: "string",
			description: "Energy level: low, medium, high, extreme",
		},
		era: {
			type: "string",
			description:
				"Musical era/decade: 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s, timeless, futuristic",
		},
		instruments: {
			type: "array",
			items: { type: "string" },
			description:
				'3-5 specific instruments featured, e.g. "Fender Rhodes", "TR-808 drum machine"',
		},
		tags: {
			type: "array",
			items: { type: "string" },
			description:
				"3-5 searchable tags mixing atmosphere, use case, sonic quality",
		},
		themes: {
			type: "array",
			items: { type: "string" },
			description: '2-3 lyrical themes, e.g. "love", "rebellion", "nostalgia"',
		},
		language: {
			type: "string",
			description:
				'Language of the lyrics, e.g. "English", "German", "Mixed (English/Spanish)"',
		},
		description: {
			type: "string",
			description:
				"Short 1-2 sentence music journalist description of the song story/vibe. Max 200 chars.",
		},
	},
	required: [
		"title",
		"artistName",
		"genre",
		"subGenre",
		"vocalStyle",
		"lyrics",
		"caption",
		"bpm",
		"keyScale",
		"timeSignature",
		"audioDuration",
		"mood",
		"energy",
		"era",
		"instruments",
		"tags",
		"themes",
		"language",
		"description",
	],
};

export { SYSTEM_PROMPT, SONG_SCHEMA };

export const SongMetadataSchema = z.object({
	title: z.string().describe("Song title"),
	artistName: z.string().describe("Fictional artist name"),
	genre: z.string().describe("Main genre"),
	subGenre: z.string().describe("Specific sub-genre"),
	vocalStyle: z
		.string()
		.describe(
			'Vocal description: gender + quality + style, e.g. "female breathy intimate vocal"',
		),
	lyrics: z
		.string()
		.describe(
			"Full song lyrics with rich section tags like [Verse 1 - intimate], [Chorus - anthemic], instrumental sections, and dynamic markers",
		),
	caption: z
		.string()
		.describe(
			"Audio generation caption: [genre/style], [2-4 specific instruments], [texture/production words], [mood]. No vocals, BPM, key, or duration. Max 300 chars.",
		),
	coverPrompt: z
		.string()
		.optional()
		.describe(
			"Art description only — do NOT include CD/disc framing (added automatically). Include: art style from pool, cinematic scene with specific materials/textures, spatial depth, surreal element, precise lighting, exact pigment color palette. Circular composition. No text/typography. Max 600 chars.",
		),
	bpm: z.number().describe("Beats per minute (60-200)"),
	keyScale: z.string().describe('Musical key, e.g. "C major"'),
	timeSignature: z.string().describe('Time signature, e.g. "4/4"'),
	audioDuration: z.number().describe("Duration in seconds (180-300)"),
	mood: z
		.string()
		.describe(
			"Dominant mood: euphoric, melancholic, aggressive, dreamy, playful, dark, nostalgic, futuristic, romantic, anxious, triumphant, serene, mysterious, rebellious, bittersweet, whimsical, haunting, empowering, contemplative, chaotic",
		),
	energy: z.string().describe("Energy level: low, medium, high, extreme"),
	era: z
		.string()
		.describe(
			"Musical era/decade: 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s, timeless, futuristic",
		),
	instruments: z
		.array(z.string())
		.describe(
			'3-5 specific instruments featured, e.g. "Fender Rhodes", "TR-808 drum machine"',
		),
	tags: z
		.array(z.string())
		.describe("3-5 searchable tags mixing atmosphere, use case, sonic quality"),
	themes: z
		.array(z.string())
		.describe('2-3 lyrical themes, e.g. "love", "rebellion", "nostalgia"'),
	language: z
		.string()
		.describe(
			'Language of the lyrics, e.g. "English", "German", "Mixed (English/Spanish)"',
		),
	description: z
		.string()
		.describe(
			"Short 1-2 sentence music journalist description of the song story/vibe. Max 200 chars.",
		),
});

export type SongMetadata = z.infer<typeof SongMetadataSchema>;

export interface RecentSong {
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	vocalStyle?: string;
	mood?: string;
	energy?: string;
}

const PlaylistManagerSchema = z.object({
	managerBrief: z
		.string()
		.describe(
			"Compact playlist operating brief for downstream song generation. Include core sonic identity, exploration lanes, ACE caption/lyrics consistency guardrails, and anti-patterns.",
		),
});

const PLAYLIST_MANAGER_PROMPT = `You are a playlist-level music director optimizing prompts for ACE-Step text2music.

Write a concise manager brief that will guide multiple per-song generations.

Requirements:
- Keep one coherent musical identity with room for controlled exploration.
- Encode guardrails for ACE-Step:
  - Caption is global style/instrument/texture/mood only.
  - Lyrics are the temporal script with concise section tags.
  - Caption and lyrics tags must stay consistent.
  - Avoid conflicting style instructions.
- Include 3-6 "avoid patterns" that previously caused weak output.
- Include a short persona target for what the listener should feel across songs.

Output JSON with only "managerBrief".`;

function clampInt(
	val: number,
	min: number,
	max: number,
	fallback: number,
): number {
	const n = Number.isFinite(val) ? val : fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** Sanitize LLM-generated metadata: clamp numeric fields to safe ranges and normalize strings */
function validateSongMetadata(raw: SongMetadata): SongMetadata {
	const normalizedOutputLanguage = normalizeLyricsLanguage(raw.language);
	const languageLabel =
		normalizedOutputLanguage === "german" ? "German" : "English";

	return {
		...raw,
		title: raw.title?.trim() || "Untitled",
		artistName: raw.artistName?.trim() || "Unknown Artist",
		genre: raw.genre?.trim() || "Electronic",
		subGenre: raw.subGenre?.trim() || "Ambient",
		vocalStyle: raw.vocalStyle?.trim() || "female smooth vocal",
		lyrics: raw.lyrics?.trim() || "[Instrumental]",
		caption:
			raw.caption?.trim() ||
			"ambient electronic, soft pads, gentle beat, dreamy atmosphere",
		coverPrompt: raw.coverPrompt?.trim() || undefined,
		bpm: clampInt(raw.bpm, 60, 200, 120),
		audioDuration: clampInt(raw.audioDuration, 30, 600, 240),
		keyScale: raw.keyScale?.trim() || "C major",
		timeSignature:
			typeof raw.timeSignature === "string" &&
			/^\d+\/\d+$/.test(raw.timeSignature)
				? raw.timeSignature
				: "4/4",
		mood: raw.mood?.trim() || "dreamy",
		energy: raw.energy?.trim() || "medium",
		era: raw.era?.trim() || "2020s",
		instruments:
			raw.instruments?.length > 0
				? raw.instruments
				: ["synthesizer", "drum machine", "bass"],
		tags: raw.tags?.length > 0 ? raw.tags : ["electronic", "ambient"],
		themes: raw.themes?.length > 0 ? raw.themes : ["atmosphere"],
		language: languageLabel,
		description: raw.description?.trim() || "An AI-generated track.",
	};
}

const PersonaSchema = z.object({
	persona: z
		.string()
		.describe(
			"Concise musical DNA summary covering genre family, production aesthetic, vocal character, mood/energy patterns, instrumentation signature, lyrical world. 200-400 characters.",
		),
});

const PERSONA_SYSTEM_PROMPT = `You are a music analyst. Extract the musical DNA of this song into a concise persona summary covering: genre family, production aesthetic, vocal character, mood/energy patterns, instrumentation signature, lyrical world. Be specific and concise. Return JSON with a single "persona" field.`;

export interface PersonaInput {
	title?: string;
	artistName?: string;
	genre?: string;
	subGenre?: string;
	mood?: string;
	energy?: string;
	era?: string;
	vocalStyle?: string;
	instruments?: string[];
	themes?: string[];
	description?: string;
	lyrics?: string;
}

export async function generatePersonaExtract(options: {
	song: PersonaInput;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const { song, provider, model, signal } = options;
	const resolved = resolveTextLlmProfile({ provider, model });

	const lines: string[] = [];
	if (song.title) lines.push(`Title: "${song.title}"`);
	if (song.artistName) lines.push(`Artist: ${song.artistName}`);
	if (song.genre)
		lines.push(
			`Genre: ${song.genre}${song.subGenre ? ` / ${song.subGenre}` : ""}`,
		);
	if (song.mood) lines.push(`Mood: ${song.mood}`);
	if (song.energy) lines.push(`Energy: ${song.energy}`);
	if (song.era) lines.push(`Era: ${song.era}`);
	if (song.vocalStyle) lines.push(`Vocal: ${song.vocalStyle}`);
	if (song.instruments?.length)
		lines.push(`Instruments: ${song.instruments.join(", ")}`);
	if (song.themes?.length) lines.push(`Themes: ${song.themes.join(", ")}`);
	if (song.description) lines.push(`Description: ${song.description}`);
	if (song.lyrics) lines.push(`Lyrics excerpt: ${song.lyrics.slice(0, 300)}`);

	const userMessage = lines.join("\n");

	const result = await callLlmObject({
		provider: resolved.provider,
		model: resolved.model,
		system: PERSONA_SYSTEM_PROMPT,
		prompt: userMessage,
		schema: PersonaSchema,
		schemaName: "persona_extract",
		temperature: 0.7,
		signal,
	});

	const persona =
		typeof result.persona === "string" ? result.persona.trim() : "";
	if (!persona) throw new Error("Empty persona extract");
	return persona;
}

export async function generatePlaylistManagerBrief(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	lyricsLanguage?: string;
	recentSongs?: RecentSong[];
	recentDescriptions?: string[];
	steerHistory?: Array<{ epoch: number; direction: string; at: number }>;
	previousBrief?: string | null;
	signal?: AbortSignal;
}): Promise<string> {
	const {
		prompt,
		provider,
		model,
		lyricsLanguage,
		recentSongs,
		recentDescriptions,
		steerHistory,
		previousBrief,
		signal,
	} = options;
	const resolved = resolveTextLlmProfile({ provider, model });

	const normalizedLanguage = normalizeLyricsLanguage(lyricsLanguage);
	const languageLabel = normalizedLanguage === "german" ? "German" : "English";

	const messageParts: string[] = [];
	messageParts.push(`Playlist prompt: ${prompt}`);
	messageParts.push(`Lyrics language lock: ${languageLabel}`);

	if (previousBrief?.trim()) {
		messageParts.push(`Previous manager brief: ${previousBrief.trim()}`);
	}

	if (steerHistory?.length) {
		const steering = steerHistory
			.slice(-10)
			.map((entry) => {
				const at = new Date(entry.at).toISOString();
				return `- epoch ${entry.epoch} @ ${at}: ${entry.direction}`;
			})
			.join("\n");
		messageParts.push(`Recent steering history:\n${steering}`);
	}

	if (recentSongs?.length) {
		const recent = recentSongs
			.slice(0, 12)
			.map(
				(s, i) =>
					`${i + 1}. "${s.title}" by ${s.artistName} — ${s.genre}/${s.subGenre}${s.vocalStyle ? `, ${s.vocalStyle}` : ""}${s.mood ? `, mood=${s.mood}` : ""}${s.energy ? `, energy=${s.energy}` : ""}`,
			)
			.join("\n");
		messageParts.push(`Recent generated songs:\n${recent}`);
	}

	if (recentDescriptions?.length) {
		const recents = recentDescriptions
			.slice(0, 20)
			.map((d, i) => `${i + 1}. ${d}`)
			.join("\n");
		messageParts.push(`Recent story angles:\n${recents}`);
	}

	const result = await callLlmObject({
		provider: resolved.provider,
		model: resolved.model,
		system: PLAYLIST_MANAGER_PROMPT,
		prompt: messageParts.join("\n\n"),
		schema: PlaylistManagerSchema,
		schemaName: "playlist_manager_brief",
		temperature: 0.6,
		signal,
	});

	const brief =
		typeof result.managerBrief === "string" ? result.managerBrief.trim() : "";
	if (!brief) throw new Error("Empty playlist manager brief");
	return brief.slice(0, 1800);
}

export async function generateSongMetadata(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	lyricsLanguage?: string;
	managerBrief?: string;
	targetBpm?: number;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
	recentSongs?: RecentSong[];
	recentDescriptions?: string[];
	isInterrupt?: boolean;
	promptDistance?: PromptDistance;
	signal?: AbortSignal;
}): Promise<SongMetadata> {
	const {
		prompt,
		provider,
		model,
		lyricsLanguage,
		managerBrief,
		targetBpm,
		targetKey,
		timeSignature,
		audioDuration,
		recentSongs,
		recentDescriptions,
		isInterrupt,
		promptDistance,
		signal,
	} = options;
	const resolved = resolveTextLlmProfile({ provider, model });

	const normalizedLanguage = normalizeLyricsLanguage(lyricsLanguage);
	const languageLabel = normalizedLanguage === "german" ? "German" : "English";

	// Determine prompt distance: explicit > interrupt flag > default close
	const distance: PromptDistance =
		promptDistance ?? (isInterrupt ? "faithful" : "close");

	let temperature: number;
	switch (distance) {
		case "faithful":
			temperature = 0.7;
			break;
		case "album":
			temperature = 0.9;
			break;
		default:
			temperature = 0.85;
	}

	let systemPrompt = getSystemPrompt(distance);

	systemPrompt += `\n\nIMPORTANT: Write ALL lyrics in ${languageLabel}.`;
	systemPrompt += `\nSet the "language" field exactly to "${languageLabel}".`;
	if (targetKey) {
		systemPrompt += `\n\nUse the musical key: ${targetKey}.`;
	}
	if (timeSignature) {
		systemPrompt += `\n\nUse time signature: ${timeSignature}.`;
	}
	if (audioDuration) {
		systemPrompt += `\n\nTarget audio duration: ${audioDuration} seconds.`;
	}

	// Build user message with soft recent-song awareness (no bans, no forced switches)
	let userMessage = prompt;
	if (managerBrief?.trim()) {
		userMessage += `\n\n--- Playlist manager brief (high priority guidance) ---\n${managerBrief.trim()}`;
	}
	if (distance !== "faithful" && recentSongs && recentSongs.length > 0) {
		const historyLines = recentSongs
			.map(
				(s, i) =>
					`  ${i + 1}. "${s.title}" by ${s.artistName} — ${s.genre} / ${s.subGenre}${s.vocalStyle ? ` (${s.vocalStyle})` : ""}${s.mood ? ` [${s.mood}]` : ""}`,
			)
			.join("\n");

		userMessage += `\n\n--- Recent songs in this playlist (for awareness — avoid duplicate titles/artists) ---\n${historyLines}`;
		userMessage += `\nCreate a fresh song with a different title, different artist, and ideally a different vocal style from the most recent entries.`;
	}

	// Append broader description history for thematic variety
	if (
		distance !== "faithful" &&
		recentDescriptions &&
		recentDescriptions.length > 0
	) {
		userMessage += `\n\n--- Recent song themes (try a different story/angle) ---\n${recentDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join("\n")}`;
	}

	const raw = await callLlmObject({
		provider: resolved.provider,
		model: resolved.model,
		system: systemPrompt,
		prompt: userMessage,
		schema: SongMetadataSchema,
		schemaName: "song_specification",
		temperature,
		seed:
			resolved.provider === "ollama"
				? Math.floor(Math.random() * 2147483647)
				: undefined,
		signal,
	});

	const songData = validateSongMetadata(raw);

	if (targetBpm && targetBpm >= 60 && targetBpm <= 220) {
		songData.bpm = targetBpm;
	}

	return songData;
}
