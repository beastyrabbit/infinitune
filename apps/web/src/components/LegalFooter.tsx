import { useRouterState } from "@tanstack/react-router";

export function LegalFooter() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (pathname === "/autoplayer/mini" || pathname === "/autoplayer/mini/") {
		return null;
	}
	return (
		<footer className="border-t border-white/10 bg-gray-950 px-4 py-5 font-mono text-xs text-white/60">
			<nav
				aria-label="Legal information"
				className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-6 gap-y-2"
			>
				<a
					href="/legal-notice"
					className="underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
				>
					Legal notice
				</a>
				<a
					href="/privacy"
					className="underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
				>
					Privacy
				</a>
			</nav>
		</footer>
	);
}
