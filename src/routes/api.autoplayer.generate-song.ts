import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

const SYSTEM_PROMPT = `You are a music producer AI. Given a music description, generate a complete song specification.

Your response must conform to the provided JSON schema. Fill in every field.

Field guidance:
- title: A creative, evocative song title
- artistName: A fictional artist/band name that fits the genre (never use real artist names)
- genre: Broad category (e.g. Rock, Electronic, Hip-Hop, Jazz, Pop, Metal, R&B, Country, Classical)
- subGenre: Specific sub-genre (e.g. Synthwave, Acid Jazz, Lo-Fi Hip-Hop, Shoegaze, Post-Punk)
- lyrics: Complete song lyrics with structural markers like [Verse 1], [Chorus], [Bridge], [Outro]. Include at least 2 verses and a chorus. Lyrics should match the mood and genre.
- caption: A concise description of the musical style for an AI audio generator — instruments, mood, tempo feel, production style. Max 200 characters.
- coverPrompt: Write this as a direct image generation prompt (not a description of what to create). Start with the subject/scene, then layer in details. Structure it like: "[art style], [main subject/scene], [composition details], [lighting], [color palette], [mood]". Examples of good styles: "cinematic matte painting", "35mm film photography", "risograph print", "90s anime cel art", "baroque oil painting", "vaporwave digital collage", "woodblock print", "infrared photograph". Be SPECIFIC — not "a city" but "rain-soaked Tokyo alley at 2am with neon reflections on wet asphalt". NEVER include any text, words, letters, band names, or typography in the prompt. Max 400 characters.
- bpm: Beats per minute appropriate for the genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for drum & bass)
- keyScale: Musical key (e.g. "C major", "A minor", "F# minor", "Bb major")
- timeSignature: Time signature (usually "4/4", but "3/4" for waltzes, "6/8" for compound time, etc.)
- audioDuration: Length in seconds, between 180 and 300 (3-5 minutes)

Rules:
- Be creative and varied — avoid generic or repetitive outputs
- Match everything to the user's description and the genre conventions
- genre should be a broad category, subGenre should be specific`;

// JSON Schema for structured output — used by both Ollama (format) and OpenRouter (response_format)
const SONG_SCHEMA = {
	type: "object" as const,
	properties: {
		title: { type: "string", description: "Song title" },
		artistName: { type: "string", description: "Fictional artist name" },
		genre: { type: "string", description: "Main genre" },
		subGenre: { type: "string", description: "Specific sub-genre" },
		lyrics: {
			type: "string",
			description: "Full song lyrics with [Verse 1], [Chorus], etc.",
		},
		caption: {
			type: "string",
			description: "Audio generation caption, max 200 chars",
		},
		coverPrompt: {
			type: "string",
			description:
				"Direct image generation prompt: [art style], [subject/scene], [composition], [lighting], [colors], [mood]. No text/words/typography. Max 400 chars.",
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
	},
	required: [
		"title",
		"artistName",
		"genre",
		"subGenre",
		"lyrics",
		"caption",
		"coverPrompt",
		"bpm",
		"keyScale",
		"timeSignature",
		"audioDuration",
	],
};

// Exported so the test page can display the full prompt
export { SYSTEM_PROMPT, SONG_SCHEMA };

export const Route = createFileRoute("/api/autoplayer/generate-song")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { prompt, provider, model } = body as {
						prompt: string;
						provider: string;
						model: string;
					};

					// Read generation settings from Convex
					const lyricsLanguage = await getSetting("lyricsLanguage");
					const bpmOverride = await getSetting("bpmOverride");

					// Build system prompt with language instruction if set
					let systemPrompt = SYSTEM_PROMPT;
					if (lyricsLanguage && lyricsLanguage !== "auto") {
						systemPrompt += `\n\nIMPORTANT: Write ALL lyrics in ${lyricsLanguage.charAt(0).toUpperCase() + lyricsLanguage.slice(1)}.`;
					}

					let fullText: string;

					if (provider === "openrouter") {
						const apiKey =
							(await getSetting("openrouterApiKey")) ||
							process.env.OPENROUTER_API_KEY ||
							"";
						const res = await fetch(
							"https://openrouter.ai/api/v1/chat/completions",
							{
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									Authorization: `Bearer ${apiKey}`,
								},
								body: JSON.stringify({
									model,
									messages: [
										{ role: "system", content: systemPrompt },
										{ role: "user", content: prompt },
									],
									response_format: {
										type: "json_schema",
										json_schema: {
											name: "song_specification",
											strict: true,
											schema: SONG_SCHEMA,
										},
									},
								}),
							},
						);
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
									{ role: "user", content: prompt },
								],
								stream: false,
								format: SONG_SCHEMA,
								keep_alive: "10m",
								options: { temperature: 0.8 },
							}),
						});
						if (!res.ok) {
							const errText = await res.text();
							throw new Error(`Ollama error ${res.status}: ${errText}`);
						}
						const data = await res.json();
						fullText = data.message?.content || "";
					}

					// Parse the JSON — structured output should give us clean JSON,
					// but fall back to extracting from code fences if needed
					let jsonStr = fullText.trim();
					const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
					if (jsonMatch) {
						jsonStr = jsonMatch[1].trim();
					}

					const songData = JSON.parse(jsonStr);

					// Apply BPM override if set and valid
					if (bpmOverride) {
						const bpm = Number.parseInt(bpmOverride, 10);
						if (bpm >= 60 && bpm <= 220) {
							songData.bpm = bpm;
						}
					}

					return new Response(JSON.stringify(songData), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: any) {
					return new Response(
						JSON.stringify({
							error: error.message || "Failed to generate song metadata",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
