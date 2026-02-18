import { createFileRoute } from "@tanstack/react-router";
import { proxyAutoplayerRequest } from "@/lib/autoplayer-proxy";

export const Route = createFileRoute("/api/autoplayer/refine-prompt")({
	server: {
		handlers: {
			POST: ({ request }) => proxyAutoplayerRequest(request, "/refine-prompt"),
		},
	},
});
