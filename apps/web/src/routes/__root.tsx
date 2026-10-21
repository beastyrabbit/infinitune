import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { LegalFooter } from "@/components/LegalFooter";
import { getTelemetryConfig } from "@/lib/telemetry/config";
import { captureBrowserError } from "@/lib/telemetry/sentry";
import { Telemetry } from "@/lib/telemetry/Telemetry";
import ApiProvider from "../integrations/api/provider";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	loader: async () => {
		try {
			return await getTelemetryConfig();
		} catch {
			return null;
		}
	},
	staleTime: Infinity,
	shouldReload: false,
	errorComponent: function RootError({ error, reset }) {
		useEffect(() => {
			captureBrowserError(error);
		}, [error]);
		return (
			<div
				role="alert"
				className="font-mono min-h-screen bg-gray-950 text-white flex items-center justify-center"
			>
				<div className="text-center">
					<p className="text-6xl font-black">ERROR</p>
					<p className="text-sm uppercase tracking-widest text-white/40 mt-2">
						Something went wrong
					</p>
					<button
						type="button"
						onClick={reset}
						className="inline-block mt-6 border-2 border-white/20 px-4 py-2 text-xs font-black uppercase hover:bg-white hover:text-black transition-colors"
					>
						Try again
					</button>
				</div>
			</div>
		);
	},
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
	const config = Route.useLoaderData();
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body className="rr-mask bg-gray-950 text-white overflow-x-clip">
				{config && <Telemetry config={config} />}
				<ApiProvider>{children}</ApiProvider>
				<LegalFooter />
				<Toaster theme="dark" position="bottom-right" richColors />
				<Scripts />
			</body>
		</html>
	);
}
