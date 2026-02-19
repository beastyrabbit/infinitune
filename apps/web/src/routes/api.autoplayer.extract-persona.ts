import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/extract-persona")({
	server: {
		handlers: {
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/extract-persona"),
		},
	},
});
