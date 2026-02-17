import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

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

					if (
						!currentPrompt ||
						typeof currentPrompt !== "string" ||
						!direction ||
						typeof direction !== "string" ||
						!provider ||
						!model
					) {
						return new Response(
							JSON.stringify({
								error:
									"Missing required fields: currentPrompt, direction, provider, model",
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
