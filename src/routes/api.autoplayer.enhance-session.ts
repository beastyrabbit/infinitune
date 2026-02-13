import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { callLlmObject } from "@/services/llm-client";

const SYSTEM_PROMPT = `You are a music production expert. Given a music description, analyze it and determine optimal audio generation parameters.

Your response must conform to the provided JSON schema.

Field guidance:
- lyricsLanguage: The language the lyrics should be written in. Infer from the description (e.g. if they mention "German rock" → "german"). Use "auto" if no language is implied.
- targetBpm: Beats per minute appropriate for the described genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for DnB)
- targetKey: Musical key that fits the mood (e.g. "A minor" for dark/aggressive, "C major" for bright/happy, "F# minor" for melancholic)
- timeSignature: Time signature (usually "4/4", "3/4" for waltzes, "6/8" for compound time)
- audioDuration: Length in seconds between 180 and 300 (3-5 minutes). Shorter for energetic tracks, longer for atmospheric ones.

Be specific and match parameters to the genre conventions described.`;

const SessionParamsSchema = z.object({
	lyricsLanguage: z
		.string()
		.describe('Language for lyrics, e.g. "english", "german", "auto"'),
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
						model: string;
					};

					if (!prompt || typeof prompt !== "string" || !provider || !model) {
						return new Response(
							JSON.stringify({
								error: "Missing required fields: prompt, provider, model",
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}

					const params = await callLlmObject({
						provider: provider as "ollama" | "openrouter",
						model,
						system: SYSTEM_PROMPT,
						prompt,
						schema: SessionParamsSchema,
						schemaName: "session_params",
						temperature: 0.7,
					});

					return new Response(JSON.stringify(params), {
						headers: { "Content-Type": "application/json" },
					});
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
