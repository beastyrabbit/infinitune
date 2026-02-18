import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/prompt-contract")({
	server: {
		handlers: {
			GET: ({ request }) => proxyAutoplayerRequest(request, "/prompt-contract"),
		},
	},
});
