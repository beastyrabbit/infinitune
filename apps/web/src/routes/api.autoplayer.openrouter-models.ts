import { createFileRoute } from "@tanstack/react-router";
import { getSetting } from "@/lib/server-settings";

export interface OpenRouterModel {
	id: string;
	name: string;
	pricing: { prompt: string; completion: string };
	context_length: number;
	architecture?: { modality?: string };
	output_modalities?: string[];
}

export const Route = createFileRoute("/api/autoplayer/openrouter-models")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				try {
					const url = new URL(request.url);
					const type = url.searchParams.get("type") || "text";

					const apiKey = await getSetting("openrouterApiKey");
					if (!apiKey) {
						return new Response(
							JSON.stringify({
								error: "No OpenRouter API key configured",
								models: [],
							}),
							{ status: 400, headers: { "Content-Type": "application/json" } },
						);
					}

					const response = await fetch("https://openrouter.ai/api/v1/models", {
						headers: { Authorization: `Bearer ${apiKey}` },
						signal: AbortSignal.timeout(10000),
					});

					if (!response.ok) {
						return new Response(
							JSON.stringify({
								error: `OpenRouter returned ${response.status}`,
								models: [],
							}),
							{ status: 502, headers: { "Content-Type": "application/json" } },
						);
					}

					const data = await response.json();
					const allModels: OpenRouterModel[] = data.data || [];

					let filtered: OpenRouterModel[];
					if (type === "image") {
						filtered = allModels.filter(
							(m) =>
								m.output_modalities?.includes("image") ||
								m.architecture?.modality === "text->image",
						);
					} else {
						filtered = allModels.filter(
							(m) =>
								m.architecture?.modality === "text->text" ||
								m.architecture?.modality === "text+image->text",
						);
					}

					const models = filtered.map((m) => ({
						id: m.id,
						name: m.name,
						promptPrice: m.pricing.prompt,
						completionPrice: m.pricing.completion,
						contextLength: m.context_length,
					}));

					return new Response(JSON.stringify({ models }), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to fetch OpenRouter models",
							models: [],
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
