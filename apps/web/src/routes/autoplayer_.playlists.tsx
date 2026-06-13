import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/autoplayer_/playlists")({
	beforeLoad: () => {
		throw redirect({ to: "/autoplayer/library" });
	},
	component: () => null,
});
