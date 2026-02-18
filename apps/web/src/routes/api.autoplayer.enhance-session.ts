import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/enhance-session")({
	server: {
		handlers: {
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/enhance-session"),
		},
	},
});
