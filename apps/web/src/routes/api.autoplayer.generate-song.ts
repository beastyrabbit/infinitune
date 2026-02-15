import { createFileRoute } from "@tanstack/react-router";
import {
	generateSongMetadata,
	SONG_SCHEMA,
	SYSTEM_PROMPT,
} from "@/services/llm";

export { SYSTEM_PROMPT, SONG_SCHEMA };

export const Route = createFileRoute("/api/autoplayer/generate-song")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const songData = await generateSongMetadata(
						body as Parameters<typeof generateSongMetadata>[0],
					);
					return new Response(JSON.stringify(songData), {
						headers: { "Content-Type": "application/json" },
					});
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to generate song metadata",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
