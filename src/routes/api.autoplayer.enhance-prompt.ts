import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

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
										{ role: "system", content: SYSTEM_PROMPT },
										{ role: "user", content: prompt },
									],
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
						const res = await fetch(`${urls.ollamaUrl}/api/chat`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								model,
								messages: [
									{ role: "system", content: SYSTEM_PROMPT },
									{ role: "user", content: prompt },
								],
								stream: false,
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

					return new Response(
						JSON.stringify({ enhancedPrompt: fullText.trim() }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
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
