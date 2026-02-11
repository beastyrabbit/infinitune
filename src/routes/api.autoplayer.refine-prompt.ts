import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

const SYSTEM_PROMPT = `You are a music session director. You will receive a current session prompt and a user direction. Merge them into an updated prompt.

Rules:
- If the user says "no more X" or "less X" — remove or de-emphasize X from the prompt
- If the user says "more Y" or "add Y" — add or emphasize Y in the prompt
- If the user gives a new style/mood/genre — weave it into the existing prompt naturally
- Keep the same approximate format and length as the original prompt
- The result should read as a coherent music description, not a list of edits
- Return ONLY the updated prompt text, nothing else`;

export const Route = createFileRoute("/api/autoplayer/refine-prompt")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { currentPrompt, direction, provider, model } = body as {
						currentPrompt: string;
						direction: string;
						provider: string;
						model: string;
					};

					const userMessage = `Current session prompt:\n"${currentPrompt}"\n\nUser direction:\n"${direction}"\n\nReturn the updated prompt:`;

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
										{ role: "user", content: userMessage },
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
									{ role: "user", content: userMessage },
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
						JSON.stringify({ updatedPrompt: fullText.trim() }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: any) {
					return new Response(
						JSON.stringify({
							error: error.message || "Failed to refine prompt",
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
