import { Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import VinylIcon from "@/components/ui/vinyl-icon";
import { useDeletePlaylist, usePlaylistsAll } from "@/integrations/api/hooks";

interface PlaylistPickerProps {
	onSelect: (playlistKey: string) => void;
	onClose: () => void;
}

export function PlaylistPicker({ onSelect, onClose }: PlaylistPickerProps) {
	const playlists = usePlaylistsAll();
	const removePlaylist = useDeletePlaylist();
	const [search, setSearch] = useState("");
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const filtered = useMemo(() => {
		if (!playlists) return [];
		const sorted = [...playlists].sort(
			(a, b) => b._creationTime - a._creationTime,
		);
		if (!search) return sorted;
		const lower = search.toLowerCase();
		return sorted.filter(
			(p) =>
				p.name.toLowerCase().includes(lower) ||
				p.prompt.toLowerCase().includes(lower),
		);
	}, [playlists, search]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* biome-ignore lint/a11y/useSemanticElements: backdrop overlay dismiss area */}
			<div
				role="button"
				tabIndex={0}
				className="absolute inset-0 bg-black/80"
				onClick={onClose}
				onKeyDown={(e) => {
					if (e.key === "Escape") onClose();
				}}
			/>
			<div className="relative z-10 w-full max-w-lg max-h-[80vh] border-4 border-white/20 bg-gray-950 flex flex-col">
				{/* Header */}
				<div className="border-b-4 border-white/20 px-4 py-3 flex items-center justify-between bg-black shrink-0">
					<div className="flex items-center gap-2">
						<VinylIcon size={16} className="text-red-500" />
						<span className="text-sm font-black uppercase tracking-widest">
							ALL PLAYLISTS
						</span>
					</div>
					<button
						type="button"
						className="text-white/60 hover:text-white"
						onClick={onClose}
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				{/* Search */}
				<div className="border-b-2 border-white/10 p-3 shrink-0">
					<div className="relative">
						<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
						<input
							type="text"
							className="w-full bg-gray-900 border-2 border-white/20 pl-8 pr-3 py-2 text-xs font-bold uppercase text-white placeholder:text-white/20 focus:outline-none focus:border-white/40"
							placeholder="SEARCH PLAYLISTS..."
							value={search}
							onChange={(e) => setSearch(e.target.value.toUpperCase())}
						/>
					</div>
				</div>

				{/* List */}
				<div className="flex-1 overflow-y-auto divide-y-2 divide-white/10">
					{playlists === undefined ? (
						<div className="p-6 text-center text-xs uppercase text-white/20">
							LOADING...
						</div>
					) : filtered.length === 0 ? (
						<div className="p-6 text-center text-xs uppercase text-white/20">
							{playlists.length === 0 ? "NO PLAYLISTS YET" : "NO MATCHES"}
						</div>
					) : (
						filtered.map((p) => (
							<div
								key={p._id}
								className="flex items-center hover:bg-white/5 transition-colors"
							>
								<button
									type="button"
									className="flex-1 px-4 py-3 flex items-center justify-between text-left min-w-0"
									onClick={() => {
										if (p.playlistKey) {
											onSelect(p.playlistKey);
										}
									}}
									disabled={!p.playlistKey}
								>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-black uppercase text-white/80 truncate">
											{p.name}
										</p>
										<div className="flex items-center gap-2 mt-0.5">
											<span className="text-[10px] uppercase tracking-wider text-white/30">
												{p.llmProvider.toUpperCase()} /{" "}
												{p.llmModel.toUpperCase()}
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
												p.status === "active"
													? "border-green-500/40 text-green-500/80"
													: p.status === "closing"
														? "border-yellow-500/40 text-yellow-500/80"
														: "border-white/20 text-white/40"
											}`}
										>
											{p.status.toUpperCase()}
										</span>
									</div>
								</button>
								{/* Delete button */}
								{confirmDeleteId === p._id ? (
									<div className="flex items-center gap-1 pr-3 shrink-0">
										<button
											type="button"
											className="px-2 py-1 text-[10px] font-black uppercase bg-red-500 text-white hover:bg-red-400 transition-colors"
											onClick={() => {
												removePlaylist({ id: p._id });
												setConfirmDeleteId(null);
											}}
										>
											DELETE
										</button>
										<button
											type="button"
											className="px-2 py-1 text-[10px] font-black uppercase text-white/40 hover:text-white/60 transition-colors"
											onClick={() => setConfirmDeleteId(null)}
										>
											CANCEL
										</button>
									</div>
								) : (
									<button
										type="button"
										className="pr-3 pl-1 py-3 text-white/15 hover:text-red-500 transition-colors shrink-0"
										onClick={() => setConfirmDeleteId(p._id)}
										title="Remove playlist"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								)}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
