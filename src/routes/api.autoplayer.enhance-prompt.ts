import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

const SYSTEM_PROMPT = `You are a music prompt expert. Expand this brief description into a focused SESSION THEME for an AI music playlist generator.

Your output defines the CENTER of a playlist. Songs will be generated at two distances from this center:
- CLOSE: songs that stay on-brand (same genre family, era, vibe)
- GENERAL: songs that explore adjacent territory (different genre, shifted mood, changed energy)

So your theme should have:
1. A CORE IDENTITY — the specific sound, era, and cultural context (this anchors the close songs)
2. An EXPLORATION RANGE — adjacent genres, moods, and styles that would feel natural in the same playlist (this guides the general songs)

Good example: "2000s German pop" → "Early 2000s German pop radio — catchy hooks, sentimental ballads, club remixes. Core sound: Neue Deutsche Welle revival meets Euro-pop production. German lyrics with occasional English choruses. Adjacent territory: German hip-hop, electronic Schlager, indie rock from Hamburg, Krautrock-influenced electronica."

Bad example: "Upbeat Eurodance with synthesizers at 128 BPM" (too specific, no room for variety)

Guidelines:
- Define the core genre/era/vibe clearly enough to anchor close songs
- Name 3-4 adjacent genres or styles for exploration
- Keep under 500 characters

Return ONLY the enhanced prompt text, nothing else.`;

export const Route = createFileRoute("/api/autoplayer/enhance-prompt")({
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

					if (!prompt || typeof prompt !== "string" || !provider || !model) {
						return new Response(
							JSON.stringify({
								error: "Missing required fields: prompt, provider, model",
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}
					const trimmedPrompt = prompt.trim().slice(0, 2000);
					if (!trimmedPrompt) {
						return new Response(
							JSON.stringify({ error: "Prompt cannot be empty" }),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}

					const result = await callLlmText({
						provider: provider as "ollama" | "openrouter",
						model,
						system: SYSTEM_PROMPT,
						prompt: trimmedPrompt,
						temperature: 0.8,
					});

					return new Response(
						JSON.stringify({ result: sanitizeLlmText(result) }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
					console.error("[enhance-prompt] LLM call failed:", error);
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to enhance prompt",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			},
		},
	},
});
