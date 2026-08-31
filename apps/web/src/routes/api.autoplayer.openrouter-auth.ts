import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/openrouter-auth")({
	server: {
		handlers: {
			GET: ({ request }) => proxyAutoplayerRequest(request, "/openrouter-auth"),
			POST: ({ request }) =>
				proxyAutoplayerRequest(request, "/openrouter-auth"),
			DELETE: ({ request }) =>
				proxyAutoplayerRequest(request, "/openrouter-auth"),
		},
	},
});
