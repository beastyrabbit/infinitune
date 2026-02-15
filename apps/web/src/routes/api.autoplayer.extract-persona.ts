import { createFileRoute } from "@tanstack/react-router";
import type { PersonaInput } from "@/services/llm";
import { generatePersonaExtract } from "@/services/llm";

interface ExtractPersonaRequest {
	song: PersonaInput;
	provider: "ollama" | "openrouter";
	model: string;
}

export const Route = createFileRoute("/api/autoplayer/extract-persona")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = (await request.json()) as ExtractPersonaRequest;
					const persona = await generatePersonaExtract({
						song: body.song,
						provider: body.provider,
						model: body.model,
					});
					return new Response(JSON.stringify({ persona }), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to extract persona",
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
