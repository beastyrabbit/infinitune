import {
	inferLyricsLanguageFromPrompt,
	normalizeLyricsLanguage,
	SUPPORTED_LYRICS_LANGUAGES,
} from "@infinitune/shared/lyrics-language";
import type {
	PlaylistManagerPlan,
	PlaylistManagerPlanSlot,
} from "@infinitune/shared/types";
import z from "zod";
import { logger } from "../logger";
import { callLlmObject, callLlmText } from "./llm-client";

interface PromptSection {
	name: string;
	content?: string | null;
}

interface PromptBuildResult {
	text: string;
	sectionChars: Record<string, number>;
}

function estimatePromptTokens(text: string): number {
	// Lightweight deterministic estimate for diagnostics; not billing-accurate.
	return Math.max(1, Math.ceil(text.length / 4));
}

function buildPromptSections(sections: PromptSection[]): PromptBuildResult {
	const sectionChars: Record<string, number> = {};
	const chunks: string[] = [];
	for (const section of sections) {
		const text = section.content?.trim();
		if (!text) continue;
		sectionChars[section.name] = text.length;
		chunks.push(text);
	}
	return {
		text: chunks.join("\n\n"),
		sectionChars,
	};
}

function logPromptBuild(
	name: string,
	parts: { kind: "system" | "user"; build: PromptBuildResult }[],
	meta?: Record<string, unknown>,
): void {
	logger.debug(
		{
			...meta,
			prompt: parts.map((part) => ({
				kind: part.kind,
				totalChars: part.build.text.length,
				estimatedTokens: estimatePromptTokens(part.build.text),
				sectionChars: part.build.sectionChars,
			})),
		},
		`Prompt build diagnostics: ${name}`,
	);
}

/**
 * OpenClaw-inspired prompt hardening:
 * strip control/format characters that can break prompt structure.
 */
function sanitizePromptLiteral(value: string): string {
	return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "");
}

function sanitizePromptOptional(value?: string | null): string | undefined {
	if (typeof value !== "string") return undefined;
	const sanitized = sanitizePromptLiteral(value).trim();
	return sanitized || undefined;
}

function sanitizePromptList(values?: string[] | null): string[] {
	if (!Array.isArray(values)) return [];
	return values
		.map((v) => sanitizePromptLiteral(String(v)).trim())
		.filter(Boolean);
}

const FIELD_GUIDANCE_INTRO = `Your response must conform to the provided JSON schema. Fill in every field.`;

const FIELD_GUIDANCE_CORE_FIELDS = `Field guidance:
- title: A creative, evocative song title
- artistName: A fictional artist/band name that fits the genre (never use real artist names)
- genre: Broad category (e.g. Rock, Electronic, Hip-Hop, Jazz, Pop, Metal, R&B, Country, Classical)
- subGenre: Specific sub-genre (e.g. Synthwave, Acid Jazz, Lo-Fi Hip-Hop, Shoegaze, Post-Punk)
- vocalStyle: Describe the vocal performance for the AI audio generator. Format: gender + vocal quality + performance style.
  Gender: male, female, duet (male+female), choir, androgynous
  Vocal quality: breathy, raspy, powerful, smooth, falsetto, gritty, husky, crystalline, airy, warm, nasal, operatic, whispered
  Performance style: soulful, energetic, intimate, passionate, anthemic, laid-back, aggressive, dreamy, playful, melancholic, defiant, tender
  Examples: "female breathy intimate vocal", "male raspy energetic vocal", "duet smooth passionate vocals", "choir powerful anthemic vocals"`;

const FIELD_GUIDANCE_LYRICS = `- lyrics: Complete song lyrics. The WRITING QUALITY is critical — these must read like real songwriting, not AI filler.
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
  If the track should be instrumental, use [Instrumental] instead of sung lyrics.`;

const FIELD_GUIDANCE_CAPTION = `- caption: Audio generation prompt. Structure: [genre/style], [2-4 specific instruments], [texture/production words], [mood]. Do NOT include vocal info, BPM, key, or duration — those go in dedicated fields. Max 300 chars.
  Examples: "shoegaze, shimmering reverb guitars, droning Juno-60 pads, tight snare, warm tape saturation, hazy and melancholic"
  "lo-fi hip-hop, dusty SP-404 samples, muted Rhodes, vinyl crackle, boom-bap drums, late-night contemplative"
  Caption and lyrics tags must never conflict on instruments, mood, or performance direction.`;

const FIELD_GUIDANCE_COVER = `- coverPrompt: A HIGHLY DETAILED art description for the image printed on this song's CD. Do NOT include "CD disc artwork" or similar framing — that is added automatically. Just describe the art itself. Max 600 chars.
  RULES:
  1. ART STYLE — Pick ONE at random. Vary art styles across songs: expired Polaroid photo, Soviet propaganda poster, ukiyo-e woodblock print, 1970s prog rock airbrush, Alphonse Mucha art nouveau, Bauhaus geometric poster, cyberpunk manga panel, Renaissance fresco fragment, 35mm Kodachrome slide, risograph zine print, Persian miniature painting, pixel art scene, chalk pastel on black paper, oil painting with visible palette knife strokes, cyanotype botanical print, 1920s Art Deco poster, VHS screen capture, stained glass window, watercolor bleed on wet paper, double exposure film photograph, linocut print, glitch art corruption, daguerreotype portrait, neon sign in fog, collage of torn magazine pages, spray paint stencil on brick wall, Dutch Golden Age still life, Chinese ink wash painting, cross-processed 35mm film, Aboriginal dot painting, 1950s pulp sci-fi cover, solarized darkroom print
  2. SCENE — A SPECIFIC, vivid scene inspired by THIS song's lyrics. Describe exact objects, materials, textures, spatial relationships. BAD: "a woman standing in rain". GOOD: "a woman in a moth-eaten velvet coat standing ankle-deep in a flooded ballroom, chandelier reflections rippling across the black water surface".
  3. MATERIALS & TEXTURES — Specify physical qualities: "cracked leather", "oxidized copper patina", "rain-streaked glass".
  4. LIGHTING — Be precise: "harsh tungsten overhead casting deep eye-socket shadows", "golden hour backlighting through dusty air".
  5. SURREAL ELEMENT — ONE unexpected detail: a clock melting over a fire escape, butterflies made of sheet music.
  6. COLOR PALETTE — Name 3-5 SPECIFIC pigment colors: "raw umber, viridian green, cadmium red deep" — NOT "warm earth tones".
  7. COMPOSITION — Design for CIRCULAR framing: radial symmetry, centered subjects, spiral patterns.
  8. NEVER include text, words, letters, typography, logos, or band/song names.`;

const FIELD_GUIDANCE_MUSIC_PARAMS = `- bpm: Beats per minute appropriate for the genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for drum & bass)
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
- description: Short 1-2 sentence music journalist description. Max 200 chars.`;

const FIELD_GUIDANCE_JSON = `JSON OUTPUT: All newlines in lyrics must be escaped as \\n. Output must be valid JSON.`;

const FIELD_GUIDANCE_FULL = buildPromptSections([
	{ name: "contract_intro", content: FIELD_GUIDANCE_INTRO },
	{ name: "core_fields", content: FIELD_GUIDANCE_CORE_FIELDS },
	{ name: "lyrics_rules", content: FIELD_GUIDANCE_LYRICS },
	{ name: "caption_rules", content: FIELD_GUIDANCE_CAPTION },
	{ name: "cover_rules", content: FIELD_GUIDANCE_COVER },
	{ name: "music_params", content: FIELD_GUIDANCE_MUSIC_PARAMS },
	{ name: "json_output", content: FIELD_GUIDANCE_JSON },
]).text;

export type PromptDistance = "close" | "general" | "faithful" | "album";
export type PromptMode = "full" | "minimal" | "none";
export type PromptProfile = "strict" | "balanced" | "creative" | "compact";

const SYSTEM_ROLE_SECTION = `You are a music producer AI. Generate production-ready, high-quality song specs for downstream audio generation.`;

const FIELD_GUIDANCE_MINIMAL = buildPromptSections([
	{ name: "contract_intro", content: FIELD_GUIDANCE_INTRO },
	{ name: "core_fields", content: FIELD_GUIDANCE_CORE_FIELDS },
	{
		name: "lyrics_rules_compact",
		content:
			"- lyrics: section-tagged and singable. Include at least one instrumental section tag. Keep section tags concise.",
	},
	{
		name: "caption_rules_compact",
		content:
			"- caption: [genre/style], [2-4 instruments], [texture], [mood]. No vocal info, BPM, key, duration.",
	},
	{
		name: "cover_rules_compact",
		content:
			"- coverPrompt: specific visual scene, concrete textures, precise lighting, 3-5 exact colors, no text/logos.",
	},
	{ name: "music_params", content: FIELD_GUIDANCE_MUSIC_PARAMS },
	{ name: "json_output", content: FIELD_GUIDANCE_JSON },
]).text;

const FIELD_GUIDANCE_NONE = buildPromptSections([
	{ name: "contract_intro", content: FIELD_GUIDANCE_INTRO },
	{
		name: "essential_fields",
		content:
			'Return valid JSON for all schema fields with concrete values; avoid placeholders. Keep "caption" production-focused and "lyrics" performance-ready.',
	},
	{ name: "json_output", content: FIELD_GUIDANCE_JSON },
]).text;

const PROFILE_BEHAVIOR: Record<PromptProfile, string> = {
	strict:
		"PROFILE=strict: maximize request adherence and controllability. Prefer conservative choices over novelty.",
	balanced:
		"PROFILE=balanced: preserve core anchors while allowing modest adjacent variation.",
	creative:
		"PROFILE=creative: keep one clear thread to the prompt, but explore adjacent moods/eras/arrangements for diversity.",
	compact:
		"PROFILE=compact: be decisive and concise. Use shortest clear phrasing that still satisfies quality and schema.",
};

const ANTI_DRIFT_RULES: Record<PromptProfile, string> = {
	strict: `ANTI-DRIFT RULES (strict):
- Keep the user's explicit genre/style anchors as written.
- Do NOT introduce new genre families, signature motifs, or setting pivots unless the user explicitly requests them.
- Keep caption, lyrics tags, and metadata mutually consistent.`,
	balanced: `ANTI-DRIFT RULES (balanced):
- Preserve explicit anchors and proper nouns.
- Adjacent variation is allowed only when it still reads as the same musical world.
- Avoid contradictions between caption, lyrics tags, and metadata.`,
	creative: `ANTI-DRIFT RULES (creative):
- Preserve at least one strong anchor from the source prompt.
- Exploration may widen mood/era/arrangement, but avoid hard identity breaks with no connective thread.
- Keep caption, lyrics tags, and metadata internally consistent.`,
	compact: `ANTI-DRIFT RULES (compact):
- Preserve explicit anchors.
- Do not introduce unrelated genre pivots.
- Keep output internally consistent.`,
};

const CREATIVE_VARIATION_RULES = `DIVERSITY TARGETS:
- Vary at least 2 dimensions among mood, energy, tempo feel, vocal texture, instrumentation, and lyrical angle.
- Prefer fresh combinations over repeating obvious prior patterns.`;

const PROMPT_CONTRACT_MAX_CHARS: Record<PromptMode, number> = {
	full: 13000,
	minimal: 6500,
	none: 2500,
};

const DISTANCE_BEHAVIOR: Record<PromptDistance, string> = {
	close: `Stay in the same genre family, similar era and vibe. Like a radio station that stays on-brand — same world, different song. Use a different title, different lyrics, and different specific instruments while keeping a cohesive overall feel.`,
	general: `Generate a song inspired by the playlist theme from a different angle. Pick adjacent genres, shift mood/energy/era, and explore while preserving a thread of connection to the source vibe.`,
	faithful: `This is a specific user request — follow it exactly. Be creative inside the requested bounds and avoid adjacent-genre detours or extra twists.`,
	album: `Create a cohesive album track derived from the source song. Keep production identity aligned while making each track genuinely distinct.`,
};

const ALBUM_RULES = `ALBUM RULES:
- Stay in the SAME genre family as the source song. Do NOT cross genre boundaries.
- Vary energy levels, mood, and tempo across tracks.
- Vary vocal style (gender, texture, performance energy).
- Each new track must differ from previous tracks in at least 3 dimensions (mood, energy, tempo, vocal style, lyrical theme, instruments).
- Preserve a cohesive production aesthetic across the full album.`;

function getFieldGuidance(mode: PromptMode): string {
	switch (mode) {
		case "none":
			return FIELD_GUIDANCE_NONE;
		case "minimal":
			return FIELD_GUIDANCE_MINIMAL;
		default:
			return FIELD_GUIDANCE_FULL;
	}
}

function defaultSongPromptProfile(distance: PromptDistance): PromptProfile {
	switch (distance) {
		case "faithful":
			return "strict";
		case "general":
			return "creative";
		default:
			return "balanced";
	}
}

function defaultSongPromptMode(
	distance: PromptDistance,
	profile: PromptProfile,
): PromptMode {
	if (profile === "compact") return "minimal";
	if (distance === "faithful") return "minimal";
	return "full";
}

const FAITHFUL_FLEX_REQUEST_RE =
	/\b(surprise me|creative libert|experiment|explore|reinterpret|unexpected|adventurous|go wild|different take|looser)\b/i;

export function resolveSongPromptProfile(options: {
	distance: PromptDistance;
	prompt: string;
	requestedProfile?: PromptProfile;
}): PromptProfile {
	const baseProfile =
		options.requestedProfile ?? defaultSongPromptProfile(options.distance);
	if (options.distance !== "faithful" || baseProfile !== "strict") {
		return baseProfile;
	}
	const safePrompt = sanitizePromptOptional(options.prompt) || "";
	return FAITHFUL_FLEX_REQUEST_RE.test(safePrompt) ? "balanced" : "strict";
}

function buildSongSystemSections(options: {
	distance: PromptDistance;
	profile: PromptProfile;
	mode: PromptMode;
}): PromptSection[] {
	const { distance, profile, mode } = options;
	return [
		{ name: "role", content: SYSTEM_ROLE_SECTION },
		{ name: "profile_behavior", content: PROFILE_BEHAVIOR[profile] },
		{ name: "distance_behavior", content: DISTANCE_BEHAVIOR[distance] },
		{ name: "anti_drift", content: ANTI_DRIFT_RULES[profile] },
		{
			name: "creative_variation",
			content:
				profile === "creative" || distance === "general"
					? CREATIVE_VARIATION_RULES
					: undefined,
		},
		{
			name: "album_rules",
			content: distance === "album" ? ALBUM_RULES : undefined,
		},
		{ name: "field_guidance", content: getFieldGuidance(mode) },
	];
}

function buildSongSystemPrompt(options: {
	distance: PromptDistance;
	profile: PromptProfile;
	mode: PromptMode;
	languageLabel: string;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
}): PromptBuildResult {
	const safeTargetKey = sanitizePromptOptional(options.targetKey);
	const safeTimeSignature = sanitizePromptOptional(options.timeSignature);
	const duration =
		typeof options.audioDuration === "number" &&
		Number.isFinite(options.audioDuration)
			? Math.round(options.audioDuration)
			: undefined;
	return buildPromptSections([
		...buildSongSystemSections({
			distance: options.distance,
			profile: options.profile,
			mode: options.mode,
		}),
		{
			name: "language_lock",
			content: `LANGUAGE LOCK (hard): Write ALL lyrics only in ${options.languageLabel}. Ignore conflicting language hints from user prompt or manager guidance. Set the "language" field exactly to "${options.languageLabel}".`,
		},
		{
			name: "target_key",
			content: safeTargetKey
				? `Use the musical key: ${safeTargetKey}.`
				: undefined,
		},
		{
			name: "time_signature",
			content: safeTimeSignature
				? `Use time signature: ${safeTimeSignature}.`
				: undefined,
		},
		{
			name: "audio_duration",
			content: duration
				? `Target audio duration: ${duration} seconds.`
				: undefined,
		},
	]);
}

/** Pick which base system prompt to use based on mode */
function getSystemPrompt(
	distance: PromptDistance,
	profile: PromptProfile = defaultSongPromptProfile(distance),
	mode: PromptMode = defaultSongPromptMode(distance, profile),
): string {
	return buildPromptSections(
		buildSongSystemSections({ distance, profile, mode }),
	).text;
}

/** Default system prompt (close distance) — used by testlab/debug views */
const SYSTEM_PROMPT = getSystemPrompt("close");

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

interface PromptBudgetContract {
	maxChars: number;
	overBudget: boolean;
	warnings: string[];
}

export interface SongPromptContract {
	distance: PromptDistance;
	mode: PromptMode;
	profile: PromptProfile;
	systemPrompt: string;
	sectionChars: Record<string, number>;
	estimatedTokens: number;
	budget: PromptBudgetContract;
	schema: typeof SONG_SCHEMA;
}

export function getSongPromptContract(
	distance: PromptDistance = "close",
	requestedProfile?: PromptProfile,
	requestedMode?: PromptMode,
): SongPromptContract {
	const profile = requestedProfile ?? defaultSongPromptProfile(distance);
	const mode = requestedMode ?? defaultSongPromptMode(distance, profile);
	const build = buildPromptSections(
		buildSongSystemSections({ distance, profile, mode }),
	);
	const maxChars = PROMPT_CONTRACT_MAX_CHARS[mode];
	const overBudget = build.text.length > maxChars;
	return {
		distance,
		mode,
		profile,
		systemPrompt: build.text,
		sectionChars: build.sectionChars,
		estimatedTokens: estimatePromptTokens(build.text),
		budget: {
			maxChars,
			overBudget,
			warnings: overBudget
				? [
						`System prompt length ${build.text.length} exceeds budget ${maxChars} chars for mode=${mode}`,
					]
				: [],
		},
		schema: SONG_SCHEMA,
	};
}

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

export interface ManagerRatingSignal {
	title: string;
	genre?: string;
	mood?: string;
	personaExtract?: string;
	rating: "up" | "down";
}

const PlaylistManagerSlotSchema = z.object({
	slot: z.number().int().min(1).max(12),
	transitionIntent: z.string(),
	topicHint: z.string(),
	captionFocus: z.string(),
	lyricTheme: z.string(),
	energyTarget: z.enum(["low", "medium", "high", "extreme"]),
});

const PlaylistManagerSchema = z.object({
	managerBrief: z
		.string()
		.describe(
			"Compact playlist operating brief for downstream song generation. Include core sonic identity, exploration lanes, ACE caption/lyrics consistency guardrails, and anti-patterns.",
		),
	strategySummary: z.string(),
	transitionPolicy: z.string(),
	avoidPatterns: z.array(z.string()),
	slots: z.array(PlaylistManagerSlotSchema).min(3).max(8),
});

const PLAYLIST_MANAGER_PROMPT = `You are a playlist-level music director for ACE-Step.

Goal: build a rolling plan for the next N songs that balances coherence, variety, and listener feedback.

Hard rules:
- Preserve the playlist's core anchors unless steer history explicitly changes them.
- Use ratings: reinforce up-rated traits, suppress down-rated traits.
- Keep caption guidance (style/instruments/texture/mood) consistent with lyrical direction.
- Avoid contradictory instructions across managerBrief, transitionPolicy, and slot directives.
- Include 3-8 concrete avoidPatterns from weak or down-rated outcomes.

Output:
- Return valid JSON only, matching the schema exactly.
- Keep managerBrief compact and actionable for downstream song generation.`;

function clampInt(
	val: number,
	min: number,
	max: number,
	fallback: number,
): number {
	const n = Number.isFinite(val) ? val : fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** Strip common LLM output artifacts from free-text responses */
function sanitizeLlmText(text: string, maxLength = 2000): string {
	let cleaned = text.trim();
	const fenced = cleaned.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
	if (fenced) cleaned = fenced[1].trim();
	if (
		(cleaned.startsWith('"') && cleaned.endsWith('"')) ||
		(cleaned.startsWith("'") && cleaned.endsWith("'"))
	) {
		cleaned = cleaned.slice(1, -1).trim();
	}
	cleaned = cleaned
		.replace(
			/^(?:Here(?:'s| is) (?:the |an? )?(?:enhanced|updated|refined|improved) (?:prompt|request|version)[:\s]*)/i,
			"",
		)
		.trim();
	if (cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength);
	return cleaned;
}

const ENHANCE_PLAYLIST_PROMPT_SYSTEM = `Rewrite a short playlist idea into one production-ready session theme.

Output:
- Exactly one compact paragraph under 500 characters.
- Return plain text only.

Requirements:
- Reuse explicit user anchors as written.
- Add 2-3 sonic identity cues.
- Add 3-4 adjacent exploration lanes that remain plausibly connected.

Anti-drift rules:
- Do not invent unrelated subgenres, eras, or signature motifs.
- Avoid hard pivots unless user intent implies it.
- No meta labels, bullets, or explanations.`;

const ENHANCE_REQUEST_SYSTEM = `Enhance a short music request for controllable generation.

Output:
- Exactly one compact paragraph under 500 characters.
- Return text only.
- Start with the original request verbatim, then add details.

Requirements:
- Preserve named references and core intent.
- Add 2-4 concrete instruments, 1-3 texture/production cues, and one concise mood phrase.
- Keep additions genre-appropriate.

Anti-drift rules:
- Do not introduce unrelated genre pivots.
- Do not add ambience/SFX layers unless explicitly requested.`;

const REFINE_PROMPT_SYSTEM = `You revise a music session prompt from a steering instruction.

Rules:
- Apply "more/add" and "less/no more" directives explicitly.
- Preserve anchors and proper nouns unless the instruction replaces them.
- Keep the revised prompt coherent, production-ready, and close in length.
- No commentary, no edit notes.

Return only the revised prompt text.`;

const SESSION_PARAMS_SYSTEM = `Convert a session description into generation parameters.

Hard constraints:
- lyricsLanguage must be "english" or "german". If unclear, choose "english".
- Keep BPM/key/time signature/duration in realistic ranges.
- Avoid unrelated genre or concept injection.
- Prefer stable defaults over risky inference.

Output:
- Return valid schema-matching content only.
- No markdown fences or extra text.`;

const SessionParamsSchema = z.object({
	lyricsLanguage: z.enum(SUPPORTED_LYRICS_LANGUAGES),
	targetBpm: z.number().describe("Beats per minute (60-220)"),
	targetKey: z.string().describe('Musical key, e.g. "A minor", "C major"'),
	timeSignature: z.string().describe('Time signature, e.g. "4/4", "3/4"'),
	audioDuration: z.number().describe("Duration in seconds (180-300)"),
});

export type SessionParams = z.infer<typeof SessionParamsSchema>;

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

const PERSONA_SYSTEM_PROMPT = `Extract a concise "musical DNA" persona from the song metadata.

Include:
- genre family
- production aesthetic
- vocal character
- mood/energy signature
- instrumentation fingerprint
- lyrical world

Output requirements:
- Return valid JSON with one field: "persona".
- Keep persona specific, compact, and non-generic.`;

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

function buildPersonaUserPrompt(song: PersonaInput): PromptBuildResult {
	const safeTitle = sanitizePromptOptional(song.title);
	const safeArtistName = sanitizePromptOptional(song.artistName);
	const safeGenre = sanitizePromptOptional(song.genre);
	const safeSubGenre = sanitizePromptOptional(song.subGenre);
	const safeMood = sanitizePromptOptional(song.mood);
	const safeEnergy = sanitizePromptOptional(song.energy);
	const safeEra = sanitizePromptOptional(song.era);
	const safeVocalStyle = sanitizePromptOptional(song.vocalStyle);
	const safeDescription = sanitizePromptOptional(song.description);
	const safeLyrics = sanitizePromptOptional(song.lyrics)?.slice(0, 300);
	const safeInstruments = sanitizePromptList(song.instruments);
	const safeThemes = sanitizePromptList(song.themes);
	return buildPromptSections([
		{
			name: "title",
			content: safeTitle ? `Title: "${safeTitle}"` : undefined,
		},
		{
			name: "artist",
			content: safeArtistName ? `Artist: ${safeArtistName}` : undefined,
		},
		{
			name: "genre",
			content: safeGenre
				? `Genre: ${safeGenre}${safeSubGenre ? ` / ${safeSubGenre}` : ""}`
				: undefined,
		},
		{ name: "mood", content: safeMood ? `Mood: ${safeMood}` : undefined },
		{
			name: "energy",
			content: safeEnergy ? `Energy: ${safeEnergy}` : undefined,
		},
		{ name: "era", content: safeEra ? `Era: ${safeEra}` : undefined },
		{
			name: "vocal",
			content: safeVocalStyle ? `Vocal: ${safeVocalStyle}` : undefined,
		},
		{
			name: "instruments",
			content:
				safeInstruments.length > 0
					? `Instruments: ${safeInstruments.join(", ")}`
					: undefined,
		},
		{
			name: "themes",
			content:
				safeThemes.length > 0 ? `Themes: ${safeThemes.join(", ")}` : undefined,
		},
		{
			name: "description",
			content: safeDescription ? `Description: ${safeDescription}` : undefined,
		},
		{
			name: "lyrics_excerpt",
			content: safeLyrics ? `Lyrics excerpt: ${safeLyrics}` : undefined,
		},
	]);
}

export async function generatePersonaExtract(options: {
	song: PersonaInput;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const { song, provider, model, signal } = options;
	const systemBuild = buildPromptSections([
		{ name: "persona_system", content: PERSONA_SYSTEM_PROMPT },
	]);
	const userBuild = buildPersonaUserPrompt(song);
	logPromptBuild(
		"persona_extract",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider, model },
	);

	const result = await callLlmObject({
		provider,
		model,
		system: systemBuild.text,
		prompt: userBuild.text,
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

export async function enhancePlaylistPrompt(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const safePrompt = sanitizePromptOptional(options.prompt)?.slice(0, 2000);
	if (!safePrompt) throw new Error("Prompt cannot be empty");
	const systemBuild = buildPromptSections([
		{
			name: "enhance_playlist_system",
			content: ENHANCE_PLAYLIST_PROMPT_SYSTEM,
		},
	]);
	const userBuild = buildPromptSections([
		{ name: "playlist_prompt", content: safePrompt },
	]);
	logPromptBuild(
		"enhance_playlist_prompt",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider: options.provider, model: options.model },
	);
	const result = await callLlmText({
		provider: options.provider,
		model: options.model,
		system: systemBuild.text,
		prompt: userBuild.text,
		temperature: 0.8,
		signal: options.signal,
	});
	return sanitizeLlmText(result, 500);
}

export async function enhanceSongRequest(options: {
	request: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const safeRequest = sanitizePromptOptional(options.request)?.slice(0, 2000);
	if (!safeRequest) throw new Error("Request cannot be empty");
	const systemBuild = buildPromptSections([
		{ name: "enhance_request_system", content: ENHANCE_REQUEST_SYSTEM },
	]);
	const userBuild = buildPromptSections([
		{ name: "song_request", content: safeRequest },
	]);
	logPromptBuild(
		"enhance_song_request",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider: options.provider, model: options.model },
	);
	const result = await callLlmText({
		provider: options.provider,
		model: options.model,
		system: systemBuild.text,
		prompt: userBuild.text,
		temperature: 0.7,
		signal: options.signal,
	});
	return sanitizeLlmText(result, 500);
}

export async function refineSessionPrompt(options: {
	currentPrompt: string;
	direction: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const safeCurrentPrompt = sanitizePromptOptional(
		options.currentPrompt,
	)?.slice(0, 2000);
	const safeDirection = sanitizePromptOptional(options.direction)?.slice(
		0,
		2000,
	);
	if (!safeCurrentPrompt || !safeDirection) {
		throw new Error("Prompt and direction cannot be empty");
	}
	const systemBuild = buildPromptSections([
		{ name: "refine_prompt_system", content: REFINE_PROMPT_SYSTEM },
	]);
	const userBuild = buildPromptSections([
		{
			name: "refine_input",
			content: `Current session prompt:\n"${safeCurrentPrompt}"\n\nUser direction:\n"${safeDirection}"\n\nReturn the updated prompt:`,
		},
	]);
	logPromptBuild(
		"refine_session_prompt",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider: options.provider, model: options.model },
	);
	const result = await callLlmText({
		provider: options.provider,
		model: options.model,
		system: systemBuild.text,
		prompt: userBuild.text,
		temperature: 0.7,
		signal: options.signal,
	});
	return sanitizeLlmText(result, 2000);
}

export async function enhanceSessionParams(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	signal?: AbortSignal;
}): Promise<SessionParams> {
	const safePrompt = sanitizePromptOptional(options.prompt)?.slice(0, 2000);
	if (!safePrompt) throw new Error("Prompt cannot be empty");
	const systemBuild = buildPromptSections([
		{ name: "session_params_system", content: SESSION_PARAMS_SYSTEM },
	]);
	const userBuild = buildPromptSections([
		{ name: "session_prompt", content: safePrompt },
	]);
	logPromptBuild(
		"enhance_session_params",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider: options.provider, model: options.model },
	);
	const params = await callLlmObject({
		provider: options.provider,
		model: options.model,
		system: systemBuild.text,
		prompt: userBuild.text,
		schema: SessionParamsSchema,
		schemaName: "session_params",
		temperature: 0.7,
		signal: options.signal,
	});
	return {
		lyricsLanguage: normalizeLyricsLanguage(
			params.lyricsLanguage ?? inferLyricsLanguageFromPrompt(safePrompt),
		),
		targetBpm: clampInt(params.targetBpm, 60, 220, 120),
		targetKey: sanitizePromptOptional(params.targetKey) || "C major",
		timeSignature:
			/^\d+\/\d+$/.test(params.timeSignature) && params.timeSignature.trim()
				? params.timeSignature.trim()
				: "4/4",
		audioDuration: clampInt(params.audioDuration, 180, 300, 240),
	};
}

export async function generatePlaylistManagerPlan(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	lyricsLanguage?: string;
	recentSongs?: RecentSong[];
	recentDescriptions?: string[];
	ratingSignals?: ManagerRatingSignal[];
	steerHistory?: Array<{ epoch: number; direction: string; at: number }>;
	previousBrief?: string | null;
	currentEpoch: number;
	planWindow?: number;
	signal?: AbortSignal;
}): Promise<{
	managerBrief: string;
	managerPlan: PlaylistManagerPlan;
}> {
	const {
		prompt,
		provider,
		model,
		lyricsLanguage,
		recentSongs,
		recentDescriptions,
		ratingSignals,
		steerHistory,
		previousBrief,
		currentEpoch,
		planWindow = 5,
		signal,
	} = options;

	const normalizedLanguage = normalizeLyricsLanguage(lyricsLanguage);
	const languageLabel = normalizedLanguage === "german" ? "German" : "English";

	const safePrompt = sanitizePromptOptional(prompt) || "Untitled session";
	const safePreviousBrief = sanitizePromptOptional(previousBrief);
	const steeringLines =
		steerHistory?.slice(-10).map((entry) => {
			const at = new Date(entry.at).toISOString();
			const direction = sanitizePromptOptional(entry.direction) || "(empty)";
			return `- epoch ${entry.epoch} @ ${at}: ${direction}`;
		}) ?? [];
	const recentSongLines =
		recentSongs?.slice(0, 12).map((song, index) => {
			const safeTitle = sanitizePromptOptional(song.title) || "Untitled";
			const safeArtist =
				sanitizePromptOptional(song.artistName) || "Unknown Artist";
			const safeGenre = sanitizePromptOptional(song.genre) || "Unknown";
			const safeSubGenre = sanitizePromptOptional(song.subGenre) || "Unknown";
			const safeVocal = sanitizePromptOptional(song.vocalStyle);
			const safeMood = sanitizePromptOptional(song.mood);
			const safeEnergy = sanitizePromptOptional(song.energy);
			return `${index + 1}. "${safeTitle}" by ${safeArtist} — ${safeGenre}/${safeSubGenre}${safeVocal ? `, ${safeVocal}` : ""}${safeMood ? `, mood=${safeMood}` : ""}${safeEnergy ? `, energy=${safeEnergy}` : ""}`;
		}) ?? [];
	const recentDescriptionLines =
		recentDescriptions?.slice(0, 20).map((description, index) => {
			const safeDescription = sanitizePromptOptional(description) || "(empty)";
			return `${index + 1}. ${safeDescription}`;
		}) ?? [];
	const feedbackLines =
		ratingSignals?.slice(0, 20).map((entry, index) => {
			const sentiment = entry.rating === "up" ? "LIKED" : "DISLIKED";
			const parts = [
				`${index + 1}. ${sentiment}: "${sanitizePromptOptional(entry.title) || "Untitled"}"`,
			];
			const safeGenre = sanitizePromptOptional(entry.genre);
			const safeMood = sanitizePromptOptional(entry.mood);
			const safePersona = sanitizePromptOptional(entry.personaExtract)?.slice(
				0,
				220,
			);
			if (safeGenre) parts.push(`genre=${safeGenre}`);
			if (safeMood) parts.push(`mood=${safeMood}`);
			if (safePersona) parts.push(`persona=${safePersona}`);
			return parts.join(" | ");
		}) ?? [];

	const systemBuild = buildPromptSections([
		{ name: "playlist_manager_system", content: PLAYLIST_MANAGER_PROMPT },
	]);
	const userBuild = buildPromptSections([
		{ name: "playlist_prompt", content: `Playlist prompt: ${safePrompt}` },
		{
			name: "language_lock",
			content: `Lyrics language lock: ${languageLabel}`,
		},
		{ name: "epoch", content: `Current epoch: ${currentEpoch}` },
		{ name: "window", content: `Plan window size: ${planWindow}` },
		{
			name: "previous_brief",
			content: safePreviousBrief
				? `Previous manager brief: ${safePreviousBrief}`
				: undefined,
		},
		{
			name: "steer_history",
			content:
				steeringLines.length > 0
					? `Recent steering history:\n${steeringLines.join("\n")}`
					: undefined,
		},
		{
			name: "recent_songs",
			content:
				recentSongLines.length > 0
					? `Recent generated songs:\n${recentSongLines.join("\n")}`
					: undefined,
		},
		{
			name: "recent_descriptions",
			content:
				recentDescriptionLines.length > 0
					? `Recent story angles:\n${recentDescriptionLines.join("\n")}`
					: undefined,
		},
		{
			name: "rating_signals",
			content:
				feedbackLines.length > 0
					? `User feedback signals:\n${feedbackLines.join("\n")}`
					: undefined,
		},
	]);
	logPromptBuild(
		"playlist_manager_plan",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{ provider, model, planWindow },
	);

	const result = await callLlmObject({
		provider,
		model,
		system: systemBuild.text,
		prompt: userBuild.text,
		schema: PlaylistManagerSchema,
		schemaName: "playlist_manager_brief",
		temperature: 0.6,
		signal,
	});

	const brief =
		typeof result.managerBrief === "string" ? result.managerBrief.trim() : "";
	if (!brief) throw new Error("Empty playlist manager brief");

	const slots: PlaylistManagerPlanSlot[] = result.slots
		.slice(0, planWindow)
		.map((slot, idx) => ({
			slot: idx + 1,
			transitionIntent: slot.transitionIntent.trim(),
			topicHint: slot.topicHint.trim(),
			captionFocus: slot.captionFocus.trim(),
			lyricTheme: slot.lyricTheme.trim(),
			energyTarget: slot.energyTarget,
		}));

	const managerPlan: PlaylistManagerPlan = {
		version: 1,
		epoch: currentEpoch,
		windowSize: planWindow,
		strategySummary:
			typeof result.strategySummary === "string"
				? result.strategySummary.trim().slice(0, 600)
				: "Maintain coherent playlist identity while varying topic and arrangement.",
		transitionPolicy:
			typeof result.transitionPolicy === "string"
				? result.transitionPolicy.trim().slice(0, 400)
				: "Adapt transition smoothness to the playlist intent and listener feedback.",
		avoidPatterns: Array.isArray(result.avoidPatterns)
			? result.avoidPatterns
					.map((pattern) => pattern.trim())
					.filter(Boolean)
					.slice(0, 8)
			: [],
		slots:
			slots.length > 0
				? slots
				: [
						{
							slot: 1,
							transitionIntent: "stay coherent with gentle variation",
							topicHint: "extend current playlist theme",
							captionFocus: "keep instrumentation family consistent",
							lyricTheme: "advance narrative without repeating lines",
							energyTarget: "medium",
						},
					],
		updatedAt: Date.now(),
	};

	return {
		managerBrief: brief.slice(0, 1800),
		managerPlan,
	};
}

function buildSongUserPrompt(options: {
	prompt: string;
	managerBrief?: string;
	managerSlot?: PlaylistManagerPlanSlot;
	managerTransitionPolicy?: string;
	distance: PromptDistance;
	profile: PromptProfile;
	recentSongs?: RecentSong[];
	recentDescriptions?: string[];
}): PromptBuildResult {
	const safePrompt =
		sanitizePromptOptional(options.prompt) || "Generate a song";
	const safeManagerBrief = sanitizePromptOptional(options.managerBrief);
	const safeTransitionPolicy = sanitizePromptOptional(
		options.managerTransitionPolicy,
	);
	const contextLimits =
		options.profile === "compact"
			? { songs: 4, descriptions: 6 }
			: options.profile === "creative"
				? { songs: 12, descriptions: 16 }
				: { songs: 8, descriptions: 10 };
	const profileDirective: Record<PromptProfile, string> = {
		strict:
			"Execution policy: strict adherence. Keep anchors exact and avoid unrelated additions.",
		balanced:
			"Execution policy: balanced. Preserve anchors while allowing modest variation.",
		creative:
			"Execution policy: creative. Explore adjacent lanes while preserving a recognizable thread.",
		compact:
			"Execution policy: compact. Be concise and decisive with no unnecessary prose.",
	};
	const recentSongLines =
		options.distance !== "faithful"
			? (options.recentSongs ?? [])
					.slice(0, contextLimits.songs)
					.map((song, index) => {
						const safeTitle = sanitizePromptOptional(song.title) || "Untitled";
						const safeArtist =
							sanitizePromptOptional(song.artistName) || "Unknown Artist";
						const safeGenre = sanitizePromptOptional(song.genre) || "Unknown";
						const safeSubGenre =
							sanitizePromptOptional(song.subGenre) || "Unknown";
						const safeVocal = sanitizePromptOptional(song.vocalStyle);
						const safeMood = sanitizePromptOptional(song.mood);
						return `  ${index + 1}. "${safeTitle}" by ${safeArtist} — ${safeGenre} / ${safeSubGenre}${safeVocal ? ` (${safeVocal})` : ""}${safeMood ? ` [${safeMood}]` : ""}`;
					})
			: [];
	const recentDescriptionLines =
		options.distance !== "faithful"
			? (options.recentDescriptions ?? [])
					.slice(0, contextLimits.descriptions)
					.map((description, index) => {
						const safeDescription =
							sanitizePromptOptional(description) || "(empty)";
						return `  ${index + 1}. ${safeDescription}`;
					})
			: [];
	const slot = options.managerSlot;
	return buildPromptSections([
		{ name: "user_prompt", content: safePrompt },
		{ name: "profile_directive", content: profileDirective[options.profile] },
		{
			name: "manager_brief",
			content: safeManagerBrief
				? `--- Playlist manager brief (high priority guidance) ---\n${safeManagerBrief}`
				: undefined,
		},
		{
			name: "transition_policy",
			content: safeTransitionPolicy
				? `Transition policy: ${safeTransitionPolicy}`
				: undefined,
		},
		{
			name: "manager_slot",
			content: slot
				? [
						"--- Current manager slot guidance ---",
						`Slot: ${slot.slot}`,
						`Transition intent: ${sanitizePromptOptional(slot.transitionIntent) || ""}`,
						`Topic hint: ${sanitizePromptOptional(slot.topicHint) || ""}`,
						`Caption focus: ${sanitizePromptOptional(slot.captionFocus) || ""}`,
						`Lyric theme: ${sanitizePromptOptional(slot.lyricTheme) || ""}`,
						`Energy target: ${slot.energyTarget}`,
					]
						.filter(Boolean)
						.join("\n")
				: undefined,
		},
		{
			name: "recent_songs",
			content:
				recentSongLines.length > 0
					? `--- Recent songs in this playlist (for awareness — avoid duplicate titles/artists) ---\n${recentSongLines.join("\n")}\nCreate a fresh song with a different title, different artist, and ideally a different vocal style from the most recent entries.`
					: undefined,
		},
		{
			name: "recent_descriptions",
			content:
				recentDescriptionLines.length > 0
					? `--- Recent song themes (try a different story/angle) ---\n${recentDescriptionLines.join("\n")}`
					: undefined,
		},
	]);
}

export async function generateSongMetadata(options: {
	prompt: string;
	provider: "ollama" | "openrouter" | "openai-codex";
	model: string;
	lyricsLanguage?: string;
	managerBrief?: string;
	managerSlot?: PlaylistManagerPlanSlot;
	managerTransitionPolicy?: string;
	targetBpm?: number;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
	recentSongs?: RecentSong[];
	recentDescriptions?: string[];
	isInterrupt?: boolean;
	promptDistance?: PromptDistance;
	promptProfile?: PromptProfile;
	promptMode?: PromptMode;
	signal?: AbortSignal;
}): Promise<SongMetadata> {
	const {
		prompt,
		provider,
		model,
		lyricsLanguage,
		managerBrief,
		managerSlot,
		managerTransitionPolicy,
		targetBpm,
		targetKey,
		timeSignature,
		audioDuration,
		recentSongs,
		recentDescriptions,
		isInterrupt,
		promptDistance,
		promptProfile,
		promptMode,
		signal,
	} = options;

	const normalizedLanguage = normalizeLyricsLanguage(lyricsLanguage);
	const languageLabel = normalizedLanguage === "german" ? "German" : "English";

	// Determine prompt distance: explicit > interrupt flag > default close
	const distance: PromptDistance =
		promptDistance ?? (isInterrupt ? "faithful" : "close");
	const profile = resolveSongPromptProfile({
		distance,
		prompt,
		requestedProfile: promptProfile,
	});
	const mode = promptMode ?? defaultSongPromptMode(distance, profile);

	let temperature: number = 0.82;
	switch (profile) {
		case "strict":
			temperature = 0.65;
			break;
		case "balanced":
			temperature = 0.82;
			break;
		case "creative":
			temperature = 0.95;
			break;
		case "compact":
			temperature = 0.72;
			break;
	}
	if (distance === "faithful") {
		temperature = Math.min(temperature, 0.72);
	} else if (distance === "album" && profile !== "strict") {
		temperature = Math.max(temperature, 0.88);
	}

	const systemBuild = buildSongSystemPrompt({
		distance,
		profile,
		mode,
		languageLabel,
		targetKey,
		timeSignature,
		audioDuration,
	});
	const userBuild = buildSongUserPrompt({
		prompt,
		managerBrief,
		managerSlot,
		managerTransitionPolicy,
		distance,
		profile,
		recentSongs,
		recentDescriptions,
	});
	logPromptBuild(
		"song_metadata",
		[
			{ kind: "system", build: systemBuild },
			{ kind: "user", build: userBuild },
		],
		{
			distance,
			profile,
			mode,
			provider,
			model,
			temperature,
		},
	);

	const raw = await callLlmObject({
		provider,
		model,
		system: systemBuild.text,
		prompt: userBuild.text,
		schema: SongMetadataSchema,
		schemaName: "song_specification",
		temperature,
		seed:
			provider === "ollama"
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
