import {
	inferLyricsLanguageFromPrompt,
	normalizeLyricsLanguage,
	SUPPORTED_LYRICS_LANGUAGES,
} from "@infinitune/shared/lyrics-language";
import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { callLlmObject } from "@/services/llm-client";

const SYSTEM_PROMPT = `You are a music production expert. Convert a session description into generation-ready parameters.

Hard constraints:
- lyricsLanguage MUST be "english" or "german" only. If ambiguous, choose "english".
- Keep inferred parameters inside realistic genre ranges.
- Do not add unrelated genres or concepts.
- Prefer stable defaults over risky guesses.

Output requirements:
- Return only content that matches the requested schema.
- Do not wrap output in markdown code fences.`;

const SessionParamsSchema = z.object({
	lyricsLanguage: z.enum(SUPPORTED_LYRICS_LANGUAGES),
	targetBpm: z.number().describe("Beats per minute (60-220)"),
	targetKey: z.string().describe('Musical key, e.g. "A minor", "C major"'),
	timeSignature: z.string().describe('Time signature, e.g. "4/4", "3/4"'),
	audioDuration: z.number().describe("Duration in seconds (180-300)"),
});

export const Route = createFileRoute("/api/autoplayer/enhance-session")({
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

					const resolved = resolveTextLlmProfile({ provider, model });
					const params = await callLlmObject({
						provider: resolved.provider,
						model: resolved.model,
						system: SYSTEM_PROMPT,
						prompt,
						schema: SessionParamsSchema,
						schemaName: "session_params",
						temperature: 0.7,
					});

					const hardLanguage = normalizeLyricsLanguage(
						params.lyricsLanguage ?? inferLyricsLanguageFromPrompt(prompt),
					);

					return new Response(
						JSON.stringify({
							...params,
							lyricsLanguage: hardLanguage,
						}),
						{
							headers: { "Content-Type": "application/json" },
						},
					);
				} catch (error: unknown) {
					console.error("[enhance-session] LLM call failed:", error);
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to analyze session params",
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
