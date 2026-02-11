import { createFileRoute } from "@tanstack/react-router";
import { saveSongToNfs } from "@/services/storage";

export const Route = createFileRoute("/api/autoplayer/save-song")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const result = await saveSongToNfs(
						body as Parameters<typeof saveSongToNfs>[0],
					);
					return new Response(JSON.stringify(result), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error ? error.message : "Failed to save song",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
