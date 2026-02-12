import { getServiceUrls, getSetting } from "@/lib/server-settings";

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
- caption: Audio generation prompt. Structure: [genre/style], [2-4 specific instruments], [texture/production words], [mood]. Do NOT include vocal info, BPM, key, or duration — those go in dedicated fields. Max 300 chars.
  Examples: "shoegaze, shimmering reverb guitars, droning Juno-60 pads, tight snare, warm tape saturation, hazy and melancholic"
  "lo-fi hip-hop, dusty SP-404 samples, muted Rhodes, vinyl crackle, boom-bap drums, late-night contemplative"
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

/** For backward compatibility */
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
		"coverPrompt",
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

export interface SongMetadata {
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	vocalStyle: string;
	lyrics: string;
	caption: string;
	coverPrompt?: string;
	bpm: number;
	keyScale: string;
	timeSignature: string;
	audioDuration: number;
	mood: string;
	energy: string;
	era: string;
	instruments: string[];
	tags: string[];
	themes: string[];
	language: string;
	description: string;
}

export interface RecentSong {
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	vocalStyle?: string;
	mood?: string;
	energy?: string;
}

function clampInt(
	val: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const n = typeof val === "number" ? val : fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** Validate and clamp LLM-generated metadata to safe ranges */
function validateSongMetadata(raw: Record<string, unknown>): SongMetadata {
	const str = (val: unknown, fallback: string): string =>
		typeof val === "string" && val.trim() ? val.trim() : fallback;
	const strArr = (val: unknown, fallback: string[]): string[] =>
		Array.isArray(val) &&
		val.length > 0 &&
		val.every((v) => typeof v === "string")
			? val
			: fallback;

	return {
		title: str(raw.title, "Untitled"),
		artistName: str(raw.artistName, "Unknown Artist"),
		genre: str(raw.genre, "Electronic"),
		subGenre: str(raw.subGenre, "Ambient"),
		vocalStyle: str(raw.vocalStyle, "female smooth vocal"),
		lyrics: str(raw.lyrics, "[Instrumental]"),
		caption: str(
			raw.caption,
			"ambient electronic, soft pads, gentle beat, dreamy atmosphere",
		),
		coverPrompt:
			typeof raw.coverPrompt === "string" ? raw.coverPrompt.trim() : undefined,
		bpm: clampInt(raw.bpm, 60, 200, 120),
		keyScale: str(raw.keyScale, "C major"),
		timeSignature:
			typeof raw.timeSignature === "string" &&
			/^\d+\/\d+$/.test(raw.timeSignature)
				? raw.timeSignature
				: "4/4",
		audioDuration: clampInt(raw.audioDuration, 30, 600, 240),
		mood: str(raw.mood, "dreamy"),
		energy: str(raw.energy, "medium"),
		era: str(raw.era, "2020s"),
		instruments: strArr(raw.instruments, [
			"synthesizer",
			"drum machine",
			"bass",
		]),
		tags: strArr(raw.tags, ["electronic", "ambient"]),
		themes: strArr(raw.themes, ["atmosphere"]),
		language: str(raw.language, "English"),
		description: str(raw.description, "An AI-generated track."),
	};
}

/** Repair common LLM JSON output issues: unescaped control chars, markdown artifacts, internal quotes */
function repairJson(raw: string): string {
	// Strip markdown bold/italic markers that some LLMs inject
	const s = raw.replace(/\*\*/g, "");

	// Walk character-by-character to fix issues inside JSON strings
	let result = "";
	let inString = false;
	let escaped = false;

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];

		if (escaped) {
			result += ch;
			escaped = false;
			continue;
		}

		if (ch === "\\" && inString) {
			result += ch;
			escaped = true;
			continue;
		}

		if (ch === '"') {
			if (!inString) {
				inString = true;
				result += ch;
			} else {
				// Determine if this quote ends the string or is an unescaped internal quote
				// Look ahead: if next non-whitespace is a JSON structural char, it's the real end
				let j = i + 1;
				while (
					j < s.length &&
					(s[j] === " " || s[j] === "\t" || s[j] === "\r" || s[j] === "\n")
				)
					j++;
				const next = s[j];
				if (
					next === "," ||
					next === "}" ||
					next === "]" ||
					next === ":" ||
					next === undefined
				) {
					inString = false;
					result += ch;
				} else {
					// Internal quote — escape it
					result += '\\"';
				}
			}
			continue;
		}

		if (inString) {
			if (ch === "\n") {
				result += "\\n";
				continue;
			}
			if (ch === "\r") {
				result += "\\r";
				continue;
			}
			if (ch === "\t") {
				result += "\\t";
				continue;
			}
		}

		result += ch;
	}

	return result;
}

const PERSONA_SCHEMA = {
	type: "object" as const,
	properties: {
		persona: {
			type: "string",
			description:
				"Concise musical DNA summary covering genre family, production aesthetic, vocal character, mood/energy patterns, instrumentation signature, lyrical world. 200-400 characters.",
		},
	},
	required: ["persona"],
};

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
	provider: "ollama" | "openrouter";
	model: string;
	signal?: AbortSignal;
}): Promise<string> {
	const { song, provider, model, signal } = options;

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
	let fullText: string;

	if (provider === "openrouter") {
		const apiKey =
			(await getSetting("openrouterApiKey")) ||
			process.env.OPENROUTER_API_KEY ||
			"";
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: PERSONA_SYSTEM_PROMPT },
					{ role: "user", content: userMessage },
				],
				temperature: 0.7,
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "persona_extract",
						strict: true,
						schema: PERSONA_SCHEMA,
					},
				},
			}),
			signal,
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`OpenRouter error ${res.status}: ${errText}`);
		}
		const data = await res.json();
		fullText = data.choices?.[0]?.message?.content || "";
	} else {
		const urls = await getServiceUrls();
		const ollamaUrl = urls.ollamaUrl;
		const res = await fetch(`${ollamaUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: PERSONA_SYSTEM_PROMPT },
					{ role: "user", content: userMessage },
				],
				stream: false,
				format: PERSONA_SCHEMA,
				think: false,
				keep_alive: "10m",
				options: { temperature: 0.7 },
			}),
			signal,
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Ollama error ${res.status}: ${errText}`);
		}
		const data = await res.json();
		fullText = data.message?.content || "";
	}

	let jsonStr = fullText.trim();
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}
	jsonStr = repairJson(jsonStr);

	const parsed = JSON.parse(jsonStr);
	const persona =
		typeof parsed.persona === "string" ? parsed.persona.trim() : "";
	if (!persona) throw new Error("Empty persona extract");
	return persona;
}

export async function generateSongMetadata(options: {
	prompt: string;
	provider: "ollama" | "openrouter";
	model: string;
	lyricsLanguage?: string;
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

	// Determine prompt distance: explicit > interrupt flag > default close
	const distance: PromptDistance =
		promptDistance ?? (isInterrupt ? "faithful" : "close");
	const temperature =
		distance === "faithful" ? 0.7 : distance === "album" ? 0.9 : 0.85;

	let systemPrompt = getSystemPrompt(distance);

	if (lyricsLanguage && lyricsLanguage !== "auto") {
		systemPrompt += `\n\nIMPORTANT: Write ALL lyrics in ${lyricsLanguage.charAt(0).toUpperCase() + lyricsLanguage.slice(1)}.`;
	}
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

	let fullText: string;

	if (provider === "openrouter") {
		const apiKey =
			(await getSetting("openrouterApiKey")) ||
			process.env.OPENROUTER_API_KEY ||
			"";
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
				temperature,
				response_format: {
					type: "json_schema",
					json_schema: {
						name: "song_specification",
						strict: true,
						schema: SONG_SCHEMA,
					},
				},
			}),
			signal,
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`OpenRouter error ${res.status}: ${errText}`);
		}
		const data = await res.json();
		fullText = data.choices?.[0]?.message?.content || "";
	} else {
		const urls = await getServiceUrls();
		const ollamaUrl = urls.ollamaUrl;
		const res = await fetch(`${ollamaUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userMessage },
				],
				stream: false,
				format: SONG_SCHEMA,
				think: false,
				keep_alive: "10m",
				options: { temperature, seed: Math.floor(Math.random() * 2147483647) },
			}),
			signal,
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Ollama error ${res.status}: ${errText}`);
		}
		const data = await res.json();
		fullText = data.message?.content || "";
	}

	let jsonStr = fullText.trim();
	const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonMatch) {
		jsonStr = jsonMatch[1].trim();
	}

	jsonStr = repairJson(jsonStr);

	const songData = validateSongMetadata(JSON.parse(jsonStr));

	if (targetBpm && targetBpm >= 60 && targetBpm <= 220) {
		songData.bpm = targetBpm;
	}

	return songData;
}
