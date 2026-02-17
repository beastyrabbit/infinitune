import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

const SYSTEM_PROMPT = `You enhance short music requests for audio generation.

Requirements:
- Output ONE compact paragraph under 500 characters. Return text only.
- Start with the user's request verbatim, then append details.
- Preserve the original intent and any named references exactly; do not introduce new themes/settings, eras, or genre pivots.
- Add only actionable sonic detail that improves controllability.
- Add exactly: 2-4 specific instruments, 1-3 production/texture cues, and one concise mood-atmosphere phrase.
- Instruments must be genre-appropriate and must not add new genre tags (e.g., "jazz", "orchestral") unless the user mentioned them.
- Mood phrase must reflect cues already present in the request (avoid invented vibes like "cinematic" unless implied).
- Do not add explicit ambience/SFX layers unless the user asked for them.`;

export const Route = createFileRoute("/api/autoplayer/enhance-request")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const {
						request: songRequest,
						provider,
						model,
					} = body as {
						request: string;
						provider: string;
						model?: string;
					};

					if (!songRequest || typeof songRequest !== "string" || !provider) {
						return new Response(
							JSON.stringify({
								error: "Missing required fields: request, provider",
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}
					const trimmedRequest = songRequest.trim().slice(0, 2000);
					if (!trimmedRequest) {
						return new Response(
							JSON.stringify({ error: "Request cannot be empty" }),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}

					const resolved = resolveTextLlmProfile({ provider, model });
					const result = await callLlmText({
						provider: resolved.provider,
						model: resolved.model,
						system: SYSTEM_PROMPT,
						prompt: trimmedRequest,
						temperature: 0.7,
					});

					return new Response(
						JSON.stringify({ result: sanitizeLlmText(result) }),
						{ headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
					console.error("[enhance-request] LLM call failed:", error);
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to enhance request",
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
