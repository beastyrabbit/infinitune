import {
	createFileRoute,
	Link,
	Outlet,
	useMatches,
} from "@tanstack/react-router";

export const Route = createFileRoute("/autoplayer_/testlab")({
	component: TestLabLayout,
});

function TestLabLayout() {
	const matches = useMatches();
	// Show INDEX link when on a child page (not the landing/index)
	const isChild = matches.some(
		(m) =>
			m.routeId !== "/autoplayer_/testlab" &&
			m.routeId !== "/autoplayer_/testlab/",
	);

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
						TEST LAB
					</h1>
					<div className="flex items-center gap-3">
						{isChild && (
							<Link
								to="/autoplayer/testlab"
								className="font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500"
							>
								[INDEX]
							</Link>
						)}
						<Link
							to="/autoplayer"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
						>
							[BACK]
						</Link>
					</div>
				</div>
			</header>

			<Outlet />
		</div>
	);
}
