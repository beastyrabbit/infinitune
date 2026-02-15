import { createFileRoute } from "@tanstack/react-router";
import { submitToAce } from "@/services/ace";

export const Route = createFileRoute("/api/autoplayer/submit-ace")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const result = await submitToAce(
						body as Parameters<typeof submitToAce>[0],
					);
					return new Response(JSON.stringify(result), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to submit to ACE-Step",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
