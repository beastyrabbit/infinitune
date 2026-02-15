import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import { Toaster } from "sonner";
import ApiProvider from "../integrations/api/provider";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	component: RootComponent,
	notFoundComponent: () => (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex items-center justify-center">
			<div className="text-center">
				<p className="text-6xl font-black">404</p>
				<p className="text-sm uppercase tracking-widest text-white/40 mt-2">
					NOT FOUND
				</p>
				<a
					href="/autoplayer"
					className="inline-block mt-6 border-2 border-white/20 px-4 py-2 text-xs font-black uppercase hover:bg-white hover:text-black transition-colors"
				>
					GO TO PLAYER
				</a>
			</div>
		</div>
	),
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "INFINITUNE",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg",
			},
			{
				rel: "icon",
				type: "image/x-icon",
				href: "/favicon.ico",
			},
		],
	}),

	shellComponent: RootDocument,
});

function RootComponent() {
	return <Outlet />;
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<ApiProvider>{children}</ApiProvider>
				<Toaster theme="dark" position="bottom-right" richColors />
				<Scripts />
			</body>
		</html>
	);
}
