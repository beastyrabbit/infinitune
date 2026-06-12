import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/house")({
	beforeLoad: () => {
		throw redirect({ to: "/autoplayer" });
	},
	component: () => null,
});
