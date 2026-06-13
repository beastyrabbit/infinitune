import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/autoplayer_/mini")({
	beforeLoad: () => {
		throw redirect({ to: "/autoplayer" });
	},
	component: () => null,
});
