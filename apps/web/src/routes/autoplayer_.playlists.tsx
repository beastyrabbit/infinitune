import type { Playlist } from "@infinitune/shared/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import ArrowBackIcon from "@/components/ui/arrow-back-icon";
import VinylIcon from "@/components/ui/vinyl-icon";
import {
	useDeletePlaylist,
	usePlaylistsAll,
	useTogglePlaylistStar,
} from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/playlists")({
	component: PlaylistsPage,
});

type ModeFilter = "all" | "endless" | "oneshot";

function PlaylistsPage() {
	const navigate = useNavigate();
	const playlists = usePlaylistsAll();
	const removePlaylist = useDeletePlaylist();
	const toggleStar = useTogglePlaylistStar();

	const [search, setSearch] = useState("");
	const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const filtered = useMemo(() => {
		if (!playlists) return [];

		let items = [...playlists];

		// Mode filter
		if (modeFilter !== "all") {
			items = items.filter((p) => p.mode === modeFilter);
		}

		// Search
		if (search) {
			const lower = search.toLowerCase();
			items = items.filter(
				(p) =>
					p.name.toLowerCase().includes(lower) ||
					p.prompt.toLowerCase().includes(lower),
			);
		}

		// Sort: starred first, then by createdAt desc
		items.sort((a, b) => {
			const aStarred = a.isStarred ? 1 : 0;
			const bStarred = b.isStarred ? 1 : 0;
			if (aStarred !== bStarred) return bStarred - aStarred;
			return b.createdAt - a.createdAt;
		});

		return items;
	}, [playlists, search, modeFilter]);

	const starredCount = useMemo(
		() => filtered.filter((p) => p.isStarred).length,
		[filtered],
	);

	const counts = useMemo(() => {
		if (!playlists) return { all: 0, endless: 0, oneshot: 0 };
		return {
			all: playlists.length,
			endless: playlists.filter((p) => p.mode === "endless").length,
			oneshot: playlists.filter((p) => p.mode === "oneshot").length,
		};
	}, [playlists]);

	// Loading
	if (playlists === undefined) {
		return (
			<div className="font-mono min-h-screen bg-gray-950 text-white">
				<header className="border-b-4 border-white/20 bg-black">
					<div className="flex items-center justify-between px-4 py-3">
						<div className="flex items-center gap-4">
							<button
								type="button"
								className="text-white/60 hover:text-white"
								onClick={() => navigate({ to: "/autoplayer" })}
							>
								<ArrowBackIcon size={20} />
							</button>
							<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
								PLAYLISTS
							</h1>
						</div>
					</div>
				</header>
				<div className="flex items-center justify-center h-64">
					<span className="text-xs uppercase tracking-widest text-white/20 animate-pulse">
						LOADING...
					</span>
				</div>
			</div>
		);
	}

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex flex-col">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black shrink-0">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<button
							type="button"
							className="text-white/60 hover:text-white"
							onClick={() => navigate({ to: "/autoplayer" })}
						>
							<ArrowBackIcon size={20} />
						</button>
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							PLAYLISTS
						</h1>
					</div>
					<span className="text-xs uppercase tracking-widest text-white/30">
						{filtered.length} / {playlists.length}
					</span>
				</div>

				{/* Search + Filters */}
				<div className="border-t-2 border-white/10 px-4 py-3 flex flex-col sm:flex-row gap-3">
					{/* Search */}
					<div className="relative flex-1">
						<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
						<input
							type="text"
							className="w-full bg-gray-900 border-2 border-white/20 pl-8 pr-3 py-2 text-xs font-bold uppercase text-white placeholder:text-white/20 focus:outline-none focus:border-white/40"
							placeholder="SEARCH BY NAME OR PROMPT..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
						/>
					</div>

					{/* Filter tabs */}
					<div className="flex gap-0 shrink-0">
						{(
							[
								{ id: "all", label: "ALL", count: counts.all },
								{ id: "endless", label: "ENDLESS", count: counts.endless },
								{ id: "oneshot", label: "ONESHOT", count: counts.oneshot },
							] as const
						).map((tab, i) => (
							<button
								key={tab.id}
								type="button"
								className={`px-3 py-2 border-2 border-white/20 text-[10px] font-black uppercase tracking-wider transition-colors ${
									i > 0 ? "border-l-0" : ""
								} ${
									modeFilter === tab.id
										? "bg-white text-black"
										: "bg-transparent text-white/60 hover:bg-white/10 hover:text-white"
								}`}
								onClick={() => setModeFilter(tab.id)}
							>
								{tab.label} ({tab.count})
							</button>
						))}
					</div>
				</div>
			</header>

			{/* LIST */}
			<main className="flex-1 overflow-y-auto">
				{filtered.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-4">
						<VinylIcon size={64} className="text-white/10 mb-4" />
						<p className="text-lg font-black uppercase text-white/30">
							{playlists.length === 0 ? "NO PLAYLISTS YET" : "NO MATCHES"}
						</p>
						<p className="text-xs uppercase tracking-wider text-white/15 mt-2">
							{playlists.length === 0
								? "START A PLAYLIST TO GENERATE MUSIC"
								: "TRY DIFFERENT FILTERS OR SEARCH TERMS"}
						</p>
					</div>
				) : (
					<div className="divide-y-2 divide-white/10">
						{/* Starred section header */}
						{starredCount > 0 && filtered.some((p) => p.isStarred) && (
							<div className="px-4 py-1.5 bg-yellow-500/5 border-b-2 border-yellow-500/20">
								<span className="text-[10px] font-black uppercase tracking-widest text-yellow-500/60">
									STARRED ({starredCount})
								</span>
							</div>
						)}

						{filtered.map((p, idx) => {
							// Insert divider between starred and non-starred
							const prevStarred = idx > 0 && filtered[idx - 1].isStarred;
							const showDivider = prevStarred && !p.isStarred;

							return (
								<PlaylistRow
									key={p.id}
									playlist={p}
									showDivider={showDivider}
									isConfirmingDelete={confirmDeleteId === p.id}
									onOpen={() => {
										if (p.playlistKey) {
											navigate({
												to:
													p.mode === "oneshot"
														? "/autoplayer/oneshot"
														: "/autoplayer",
												search: { pl: p.playlistKey },
											});
										}
									}}
									onToggleStar={() => toggleStar({ id: p.id })}
									onRequestDelete={() => setConfirmDeleteId(p.id)}
									onConfirmDelete={() => {
										removePlaylist({ id: p.id });
										setConfirmDeleteId(null);
									}}
									onCancelDelete={() => setConfirmDeleteId(null)}
								/>
							);
						})}
					</div>
				)}
			</main>

			{/* FOOTER */}
			<footer className="bg-black px-4 py-2 border-t-4 border-white/20 shrink-0">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span>{"PLAYLISTS // MANAGEMENT"}</span>
					<span className="flex items-center gap-2">
						<VinylIcon size={12} />
						{filtered.length} SHOWN / {playlists.length} TOTAL
					</span>
				</div>
			</footer>
		</div>
	);
}

// ─── Playlist Row ────────────────────────────────────────────────────

function PlaylistRow({
	playlist: p,
	showDivider,
	isConfirmingDelete,
	onOpen,
	onToggleStar,
	onRequestDelete,
	onConfirmDelete,
	onCancelDelete,
}: {
	playlist: Playlist;
	showDivider: boolean;
	isConfirmingDelete: boolean;
	onOpen: () => void;
	onToggleStar: () => void;
	onRequestDelete: () => void;
	onConfirmDelete: () => void;
	onCancelDelete: () => void;
}) {
	return (
		<>
			{showDivider && (
				<div className="px-4 py-1.5 bg-gray-900/50">
					<span className="text-[10px] font-black uppercase tracking-widest text-white/20">
						ALL PLAYLISTS
					</span>
				</div>
			)}
			<div className="flex items-center hover:bg-white/5 transition-colors">
				{/* Star button */}
				<button
					type="button"
					className={`pl-4 pr-2 py-3 shrink-0 transition-colors ${
						p.isStarred
							? "text-yellow-500 hover:text-yellow-400"
							: "text-white/15 hover:text-yellow-500/60"
					}`}
					onClick={onToggleStar}
					title={p.isStarred ? "Unstar playlist" : "Star playlist"}
				>
					<Star
						className="h-4 w-4"
						fill={p.isStarred ? "currentColor" : "none"}
					/>
				</button>

				{/* Main content — click to open */}
				<button
					type="button"
					className="flex-1 px-3 py-3 flex items-center justify-between text-left min-w-0"
					onClick={onOpen}
					disabled={!p.playlistKey}
				>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-black uppercase text-white/80 truncate">
							{p.name}
						</p>
						<p className="text-[10px] uppercase text-white/25 truncate mt-0.5">
							{p.prompt}
						</p>
						<div className="flex items-center gap-2 mt-1">
							<span className="text-[10px] uppercase tracking-wider text-white/30">
								{p.llmProvider.toUpperCase()} / {p.llmModel.toUpperCase()}
							</span>
							<span className="text-[10px] uppercase text-white/20">
								| {p.songsGenerated} TRACKS
							</span>
						</div>
					</div>
					<div className="flex items-center gap-2 shrink-0 ml-3">
						<span
							className={`border px-1.5 py-0.5 text-[10px] font-black uppercase ${
								p.mode === "oneshot"
									? "border-yellow-500/40 text-yellow-500/80"
									: "border-white/20 text-white/40"
							}`}
						>
							{p.mode === "oneshot" ? "ONESHOT" : "ENDLESS"}
						</span>
						<span
							className={`border px-1.5 py-0.5 text-[10px] font-black uppercase ${
								(
									{
										active: "border-green-500/40 text-green-500/80",
										closing: "border-yellow-500/40 text-yellow-500/80",
									} as Record<string, string>
								)[p.status] ?? "border-white/20 text-white/40"
							}`}
						>
							{p.status.toUpperCase()}
						</span>
					</div>
				</button>

				{/* Delete button */}
				{isConfirmingDelete ? (
					<div className="flex items-center gap-1 pr-3 shrink-0">
						<button
							type="button"
							className="px-2 py-1 text-[10px] font-black uppercase bg-red-500 text-white hover:bg-red-400 transition-colors"
							onClick={onConfirmDelete}
						>
							DELETE
						</button>
						<button
							type="button"
							className="px-2 py-1 text-[10px] font-black uppercase text-white/40 hover:text-white/60 transition-colors"
							onClick={onCancelDelete}
						>
							CANCEL
						</button>
					</div>
				) : (
					<button
						type="button"
						className="pr-3 pl-1 py-3 text-white/15 hover:text-red-500 transition-colors shrink-0"
						onClick={onRequestDelete}
						title="Remove playlist"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</>
	);
}
