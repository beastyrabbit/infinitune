import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/ollama-models")({
	server: {
		handlers: {
			GET: ({ request }) => proxyAutoplayerRequest(request, "/ollama-models"),
		},
	},
});
