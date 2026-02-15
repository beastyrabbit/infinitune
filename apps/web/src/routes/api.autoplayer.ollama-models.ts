import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls } from "@/lib/server-settings";

export const Route = createFileRoute("/api/autoplayer/ollama-models")({
	server: {
		handlers: {
			GET: async () => {
				try {
					const urls = await getServiceUrls();
					const ollamaUrl = urls.ollamaUrl;

					const response = await fetch(`${ollamaUrl}/api/tags`);
					const data = await response.json();

					// Classify models by capability
					const models = (data.models || []).map(
						(m: {
							name: string;
							size?: number;
							modified_at?: string;
							details?: { families?: string[] };
						}) => {
							const families: string[] = m.details?.families || [];
							const nameLower = m.name.toLowerCase();
							const isVision =
								families.some(
									(f: string) =>
										f.includes("clip") || f.toLowerCase().includes("vl"),
								) ||
								nameLower.includes("vl") ||
								nameLower.includes("llava") ||
								nameLower.includes("vision");
							const isEmbedding =
								families.some((f: string) => f.includes("bert")) ||
								nameLower.includes("embed");
							const isOcr = nameLower.includes("ocr");

							let type = "text";
							if (isEmbedding) type = "embedding";
							else if (isVision || isOcr) type = "vision";

							return {
								name: m.name,
								size: m.size,
								modifiedAt: m.modified_at,
								vision: isVision || isOcr,
								type,
							};
						},
					);

					return new Response(JSON.stringify({ models }), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to fetch Ollama models",
							models: [],
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
