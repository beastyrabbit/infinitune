import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

const SYSTEM_PROMPT = `You are a music production expert. Given a music description, analyze it and determine optimal audio generation parameters.

Your response must conform to the provided JSON schema.

Field guidance:
- lyricsLanguage: The language the lyrics should be written in. Infer from the description (e.g. if they mention "German rock" → "german"). Use "auto" if no language is implied.
- targetBpm: Beats per minute appropriate for the described genre (e.g. 70-90 for ballads, 120-130 for house, 140-170 for DnB)
- targetKey: Musical key that fits the mood (e.g. "A minor" for dark/aggressive, "C major" for bright/happy, "F# minor" for melancholic)
- timeSignature: Time signature (usually "4/4", "3/4" for waltzes, "6/8" for compound time)
- audioDuration: Length in seconds between 180 and 300 (3-5 minutes). Shorter for energetic tracks, longer for atmospheric ones.

Be specific and match parameters to the genre conventions described.`;

const SESSION_PARAMS_SCHEMA = {
	type: "object" as const,
	properties: {
		lyricsLanguage: {
			type: "string",
			description: 'Language for lyrics, e.g. "english", "german", "auto"',
		},
		targetBpm: {
			type: "number",
			description: "Beats per minute (60-220)",
		},
		targetKey: {
			type: "string",
			description: 'Musical key, e.g. "A minor", "C major"',
		},
		timeSignature: {
			type: "string",
			description: 'Time signature, e.g. "4/4", "3/4"',
		},
		audioDuration: {
			type: "number",
			description: "Duration in seconds (180-300)",
		},
	},
	required: [
		"lyricsLanguage",
		"targetBpm",
		"targetKey",
		"timeSignature",
		"audioDuration",
	],
};

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
									response_format: {
										type: "json_schema",
										json_schema: {
											name: "session_params",
											strict: true,
											schema: SESSION_PARAMS_SCHEMA,
										},
									},
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
								format: SESSION_PARAMS_SCHEMA,
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

					let jsonStr = fullText.trim();
					const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
					if (jsonMatch) {
						jsonStr = jsonMatch[1].trim();
					}

					const params = JSON.parse(jsonStr);

					return new Response(JSON.stringify(params), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
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
