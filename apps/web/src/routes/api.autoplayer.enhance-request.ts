import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/enhance-request")({
	server: {
		handlers: {
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/enhance-request"),
		},
	},
});
