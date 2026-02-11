import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls } from "@/lib/server-settings";

export const Route = createFileRoute("/api/autoplayer/ace-models")({
	server: {
		handlers: {
			GET: async () => {
				try {
					const urls = await getServiceUrls();
					const aceUrl = urls.aceStepUrl;

					const response = await fetch(`${aceUrl}/v1/models`);
					const data = await response.json();

					// ACE-Step uses OpenAI-compatible format: { object: "list", data: [{ id, name, ... }] }
					const rawModels = data.data || data.models || [];
					const models = rawModels.map((m: { id?: string; name?: string }) => ({
						name: m.id || m.name,
						is_default: rawModels.length === 1,
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
									: "Failed to fetch ACE-Step models",
							models: [],
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
