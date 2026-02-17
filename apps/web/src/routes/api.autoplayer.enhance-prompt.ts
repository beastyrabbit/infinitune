import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

const SYSTEM_PROMPT = `You expand a short playlist idea into a robust session theme for multi-song generation.

Output ONE compact paragraph under 500 characters. Return only the enhanced session theme text.

Include:
- Core identity: reuse the user's genre/era/cultural anchor wording as written + 2-3 high-level sonic/vibe anchors.
- Exploration range: name exactly 3-4 adjacent lanes that still fit, phrased conservatively ("-leaning"/"-inflected").

Rules:
- Do not re-label or synonym-swap the user's key anchors, and do not add new substyle labels unless explicitly mentioned (e.g., don't add "synth-pop" if the user only said "pop").
- Keep lane labels conservative; avoid hard pivots like "crossover" unless the user implies it.
- Do not add prescriptive constraint clauses (no "always/never", "while staying...", or "keep the X core").
- Do not invent signature elements not implied by the input (e.g., specific vocal techniques).
- No meta labels (CORE/RANGE) and no bullet formatting.`;

export const Route = createFileRoute("/api/autoplayer/enhance-prompt")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { prompt, provider, model } = body as {
						prompt: string;
						provider: string;
						model?: string;
					};

					if (!prompt || typeof prompt !== "string" || !provider) {
						return new Response(
							JSON.stringify({
								error: "Missing required fields: prompt, provider",
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

					const resolved = resolveTextLlmProfile({ provider, model });
					const result = await callLlmText({
						provider: resolved.provider,
						model: resolved.model,
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
