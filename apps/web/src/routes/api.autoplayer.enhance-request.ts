import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLlmText } from "@/lib/sanitize-llm-text";
import { callLlmText } from "@/services/llm-client";

const SYSTEM_PROMPT = `You are a music request enhancer. The user has typed a short song request. Expand it into a richer description for an AI music producer that uses an audio generation model.

CRITICAL RULES:
- PRESERVE the user's original intent EXACTLY. If they say "german cover of bohemian rhapsody", the result MUST be about a german cover of bohemian rhapsody.
- If they reference a specific song, artist, style, or concept — keep it front and center.
- Do NOT redirect to a different genre or concept.

ENRICH with these audio-generation-friendly dimensions:
- Name 2-4 SPECIFIC instruments (e.g. "detuned Juno-106 pads", "fingerpicked nylon guitar", "tight 808 kick")
- Add texture/production words (e.g. "warm tape saturation", "crisp digital production", "lo-fi vinyl crackle")
- Describe the mood atmosphere (e.g. "hazy late-night", "euphoric festival energy", "intimate bedroom")
- These details help the audio model produce more accurate results.

Keep under 500 characters. Return ONLY the enhanced request text, nothing else.`;

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
						model: string;
					};

					if (
						!songRequest ||
						typeof songRequest !== "string" ||
						!provider ||
						!model
					) {
						return new Response(
							JSON.stringify({
								error: "Missing required fields: request, provider, model",
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
