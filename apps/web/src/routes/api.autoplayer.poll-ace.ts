import { createFileRoute } from "@tanstack/react-router";
import { pollAce } from "@/services/ace";

export const Route = createFileRoute("/api/autoplayer/poll-ace")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { taskId } = body as { taskId: string };
					const result = await pollAce(taskId);
					return new Response(JSON.stringify(result), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to poll ACE-Step",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
