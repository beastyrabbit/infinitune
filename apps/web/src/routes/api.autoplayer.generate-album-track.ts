import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/generate-album-track")({
	server: {
		handlers: {
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/generate-album-track"),
		},
	},
});
