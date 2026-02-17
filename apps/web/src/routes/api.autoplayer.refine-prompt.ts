import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

const SYSTEM_PROMPT = `You are a music session director. Revise a session prompt from a steering instruction.

Rules:
- Execute "less/no more" and "more/add" directions explicitly.
- Preserve core style anchors and proper nouns unless replaced by instruction.
- Keep the revised text coherent, production-ready, and close to original length.
- Do not output edit notes or explanations.

Return only the updated session prompt.`;

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
						model?: string;
					};

					if (
						!currentPrompt ||
						typeof currentPrompt !== "string" ||
						!direction ||
						typeof direction !== "string" ||
						!provider
					) {
						return new Response(
							JSON.stringify({
								error:
									"Missing required fields: currentPrompt, direction, provider",
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}
					const trimmedPrompt = currentPrompt.trim().slice(0, 2000);
					const trimmedDirection = direction.trim().slice(0, 2000);
					if (!trimmedPrompt || !trimmedDirection) {
						return new Response(
							JSON.stringify({ error: "Prompt and direction cannot be empty" }),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}

					const userMessage = `Current session prompt:\n"${trimmedPrompt}"\n\nUser direction:\n"${trimmedDirection}"\n\nReturn the updated prompt:`;

					const resolved = resolveTextLlmProfile({ provider, model });
					const result = await callLlmText({
						provider: resolved.provider,
						model: resolved.model,
						system: SYSTEM_PROMPT,
						prompt: userMessage,
						temperature: 0.7,
					});

					return new Response(
						JSON.stringify({ result: sanitizeLlmText(result) }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
					console.error("[refine-prompt] LLM call failed:", error);
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to refine prompt",
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
