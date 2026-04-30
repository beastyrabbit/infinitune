import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { OrchestratorPanel } from "@/components/autoplayer/OrchestratorPanel";
import ArrowBackIcon from "@/components/ui/arrow-back-icon";
import { Badge } from "@/components/ui/badge";
import { useCurrentPlaylist, usePlaylistByKey } from "@/integrations/api/hooks";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";

export const Route = createFileRoute("/autoplayer_/orchestrator")({
	component: OrchestratorPage,
	validateSearch: validatePlaylistKeySearch,
});

function OrchestratorPage() {
	const navigate = useNavigate();
	const { pl, room, role, name, dn } = Route.useSearch();
	const playlistByKey = usePlaylistByKey(pl ?? null);
	const currentPlaylist = useCurrentPlaylist();
	const playlist = pl ? playlistByKey : currentPlaylist;
	const isLoading = pl
		? playlistByKey === undefined
		: currentPlaylist === undefined;

	const backSearch = playlist?.playlistKey
		? { pl: playlist.playlistKey, room, role, name, dn }
		: pl
			? { pl, room, role, name, dn }
			: { room, role, name, dn };

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex min-w-0 items-center gap-4">
						<button
							type="button"
							className="shrink-0 text-white/60 hover:text-white"
							onClick={() =>
								navigate({
									to: "/autoplayer",
									search: backSearch,
								})
							}
						>
							<ArrowBackIcon size={20} />
						</button>
						<div className="min-w-0">
							<h1 className="flex items-center gap-3 text-3xl font-black tracking-tighter uppercase sm:text-5xl">
								<MessageSquare className="h-7 w-7 text-red-400 sm:h-9 sm:w-9" />
								ORCHESTRATOR
							</h1>
							<p className="mt-1 truncate text-xs font-bold uppercase tracking-widest text-white/30">
								{playlist?.name ?? "PLAYLIST DIRECTOR"}
							</p>
						</div>
					</div>
					{playlist && (
						<Badge className="rounded-none border-2 border-white/30 bg-transparent font-mono text-xs font-black uppercase text-white/60">
							{playlist.status}
						</Badge>
					)}
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl p-4">
				{isLoading ? (
					<div className="border-4 border-white/10 bg-black p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
						LOADING...
					</div>
				) : playlist ? (
					<OrchestratorPanel playlistId={playlist.id} />
				) : (
					<div className="border-4 border-white/10 bg-black p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
						NO PLAYLIST SELECTED
					</div>
				)}
			</main>
		</div>
	);
}
