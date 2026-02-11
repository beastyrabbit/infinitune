import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

const SYSTEM_PROMPT = `You are a music request enhancer. The user has typed a short song request. Expand it into a richer description for an AI music producer.

CRITICAL RULES:
- PRESERVE the user's original intent EXACTLY. If they say "german cover of bohemian rhapsody", the result MUST be about a german cover of bohemian rhapsody.
- If they reference a specific song, artist, style, or concept — keep it front and center.
- Add production details, mood, instrumentation, and atmosphere — but keep it about THIS specific request.
- Do NOT redirect to a different genre or concept. "jazz ballad" must stay jazz, "punk cover" must stay punk.
- Keep under 500 characters.
- Return ONLY the enhanced request text, nothing else.`;

export const Route = createFileRoute("/api/autoplayer/enhance-request")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { request: songRequest, provider, model } = body as {
						request: string;
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
										{ role: "user", content: songRequest },
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
									{ role: "user", content: songRequest },
								],
								stream: false,
								keep_alive: "10m",
								options: { temperature: 0.7 },
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
						JSON.stringify({ enhancedRequest: fullText.trim() }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: any) {
					return new Response(
						JSON.stringify({
							error: error.message || "Failed to enhance request",
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
