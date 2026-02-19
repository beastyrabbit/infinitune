import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/generate-song")({
	server: {
		handlers: {
			POST: ({ request }) => proxyAutoplayerRequest(request, "/generate-song"),
		},
	},
});
