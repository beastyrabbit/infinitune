import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/openrouter-models")({
	server: {
		handlers: {
			GET: ({ request }) =>
				proxyAutoplayerRequest(request, "/openrouter-models"),
		},
	},
});
