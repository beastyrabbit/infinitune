import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

const SYSTEM_PROMPT = `You are a music prompt expert. Expand this brief description into a rich, detailed music generation prompt that will guide an AI music producer to create a specific, vivid song.

Add details about:
- Specific sub-genre and musical influences
- Instruments, production style, and sonic texture
- Mood, energy, and emotional arc
- Vocal style if applicable

Keep under 500 characters. Return ONLY the enhanced prompt text, nothing else.`;

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
				} catch (error: any) {
					return new Response(
						JSON.stringify({
							error: error.message || "Failed to enhance prompt",
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
