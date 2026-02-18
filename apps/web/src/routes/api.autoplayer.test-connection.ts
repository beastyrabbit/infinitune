import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/test-connection")({
	server: {
		handlers: {
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/test-connection"),
		},
	},
});
