import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useQuery } from "convex/react";
import { Pause, Play, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { TrackDetail } from "@/components/autoplayer/TrackDetail";
import ArrowBackIcon from "@/components/ui/arrow-back-icon";
import VinylIcon from "@/components/ui/vinyl-icon";
import Volume2Icon from "@/components/ui/volume-2-icon";
import VolumeXIcon from "@/components/ui/volume-x-icon";
import XIcon from "@/components/ui/x-icon";
import { formatTime } from "@/lib/format-time";
import {
	getGlobalAudio,
	playerStore,
	setCurrentSong,
	setDuration,
	setPlaying,
	setVolume,
	toggleMute,
} from "@/lib/player-store";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/autoplayer_/library")({
	component: LibraryPage,
});

// ─── Types ──────────────────────────────────────────────────────────

type RatingFilter = "liked" | "disliked" | "unrated";

interface Filters {
	genres: string[];
	moods: string[];
	energies: string[];
	eras: string[];
	languages: string[];
	ratings: RatingFilter[];
	playlists: string[];
}

const EMPTY_FILTERS: Filters = {
	genres: [],
	moods: [],
	energies: [],
	eras: [],
	languages: [],
	ratings: [],
	playlists: [],
};

// ─── Helpers ────────────────────────────────────────────────────────

function unique(arr: (string | undefined | null)[]): string[] {
	return [...new Set(arr.filter((v): v is string => !!v))].sort();
}

function matchesSearch(song: Record<string, unknown>, term: string): boolean {
	if (!term) return true;
	const lower = term.toLowerCase();
	const fields = [
		song.title,
		song.artistName,
		song.genre,
		song.subGenre,
		song.description,
		song.lyrics,
	];
	return fields.some((f) => f && String(f).toLowerCase().includes(lower));
}

function matchesFilters(
	song: Record<string, unknown>,
	filters: Filters,
	playlistMap: Map<string, string>,
): boolean {
	const genre = song.genre as string | undefined;
	const mood = song.mood as string | undefined;
	const energy = song.energy as string | undefined;
	const era = song.era as string | undefined;
	const language = song.language as string | undefined;
	const userRating = song.userRating as string | undefined;
	const playlistId = song.playlistId;

	if (filters.genres.length > 0 && (!genre || !filters.genres.includes(genre)))
		return false;
	if (filters.moods.length > 0 && (!mood || !filters.moods.includes(mood)))
		return false;
	if (
		filters.energies.length > 0 &&
		(!energy || !filters.energies.includes(energy))
	)
		return false;
	if (filters.eras.length > 0 && (!era || !filters.eras.includes(era)))
		return false;
	if (
		filters.languages.length > 0 &&
		(!language || !filters.languages.includes(language))
	)
		return false;
	if (filters.ratings.length > 0) {
		const rating: RatingFilter =
			userRating === "up"
				? "liked"
				: userRating === "down"
					? "disliked"
					: "unrated";
		if (!filters.ratings.includes(rating)) return false;
	}
	if (filters.playlists.length > 0) {
		const pid = playlistId as string;
		const playlistName = playlistMap.get(pid) || pid;
		if (!filters.playlists.includes(playlistName)) return false;
	}
	return true;
}

// ─── Mini Player ────────────────────────────────────────────────────

function MiniPlayer({
	currentSong,
}: {
	currentSong: { _id: string; title?: string; artistName?: string } | null;
}) {
	const { isPlaying, currentTime, duration, volume, isMuted } =
		useStore(playerStore);

	const handleToggle = useCallback(() => {
		const audio = getGlobalAudio();
		if (isPlaying) {
			audio.pause();
			setPlaying(false);
		} else {
			audio
				.play()
				.then(() => setPlaying(true))
				.catch(() => {});
		}
	}, [isPlaying]);

	const handleSeek = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const audio = getGlobalAudio();
			const rect = e.currentTarget.getBoundingClientRect();
			const pct = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);
			audio.currentTime = pct * duration;
		},
		[duration],
	);

	if (!currentSong) return null;

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-3 border-t-2 border-white/10 px-4 py-2 bg-black/60">
			{/* Play/Pause */}
			<button
				type="button"
				className="shrink-0 text-white hover:text-red-500 transition-colors"
				onClick={handleToggle}
			>
				{isPlaying ? (
					<Pause className="h-4 w-4" />
				) : (
					<Play className="h-4 w-4" />
				)}
			</button>

			{/* Song info */}
			<div className="shrink-0 min-w-0 max-w-[140px]">
				<p className="text-[10px] font-black uppercase truncate">
					{currentSong.title || "..."}
				</p>
				<p className="text-[9px] uppercase text-white/30 truncate">
					{currentSong.artistName || "..."}
				</p>
			</div>

			{/* Progress bar */}
			<div className="flex-1 flex items-center gap-2 min-w-0">
				<span className="text-[10px] font-bold text-white/40 shrink-0">
					{formatTime(currentTime)}
				</span>
				{/* biome-ignore lint/a11y/useSemanticElements: div used for custom seek bar layout */}
				<div
					role="button"
					tabIndex={0}
					className="flex-1 h-1.5 border border-white/20 bg-black/40 cursor-pointer"
					onClick={handleSeek}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleSeek(e as unknown as React.MouseEvent<HTMLDivElement>);
						}
					}}
				>
					<div
						className="h-full bg-red-500 transition-all"
						style={{ width: `${progress}%` }}
					/>
				</div>
				<span className="text-[10px] font-bold text-white/40 shrink-0">
					{formatTime(duration)}
				</span>
			</div>

			{/* Volume */}
			<div className="hidden sm:flex items-center gap-1.5 shrink-0">
				<button
					type="button"
					onClick={toggleMute}
					className="text-white/50 hover:text-white"
				>
					{isMuted ? <VolumeXIcon size={14} /> : <Volume2Icon size={14} />}
				</button>
				{/* biome-ignore lint/a11y/useSemanticElements: div used for custom volume bar layout */}
				<div
					role="button"
					tabIndex={0}
					className="h-1.5 w-14 border border-white/20 bg-black/40 cursor-pointer"
					onClick={(e) => {
						const rect = e.currentTarget.getBoundingClientRect();
						const pct = Math.max(
							0,
							Math.min(1, (e.clientX - rect.left) / rect.width),
						);
						setVolume(pct);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
						}
					}}
				>
					<div
						className="h-full bg-white"
						style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

// ─── Filter Section Component ───────────────────────────────────────

function FilterSection({
	title,
	options,
	selected,
	onToggle,
	counts,
}: {
	title: string;
	options: string[];
	selected: string[];
	onToggle: (value: string) => void;
	counts: Map<string, number>;
}) {
	const [collapsed, setCollapsed] = useState(false);
	if (options.length === 0) return null;

	return (
		<div className="border-b-2 border-white/10">
			<button
				type="button"
				className="w-full flex items-center justify-between px-3 py-2 text-xs font-black uppercase tracking-widest text-white/50 hover:text-white/80"
				onClick={() => setCollapsed(!collapsed)}
			>
				<span>
					{title} {selected.length > 0 && `(${selected.length})`}
				</span>
				<span>{collapsed ? "+" : "−"}</span>
			</button>
			{!collapsed && (
				<div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto">
					{options.map((opt) => {
						const active = selected.includes(opt);
						const count = counts.get(opt) ?? 0;
						return (
							<button
								type="button"
								key={opt}
								className={`w-full flex items-center justify-between px-2 py-1 text-xs font-bold uppercase transition-colors ${
									active
										? "bg-white text-black"
										: "text-white/50 hover:text-white hover:bg-white/5"
								}`}
								onClick={() => onToggle(opt)}
							>
								<span className="truncate">{opt}</span>
								<span className="ml-2 shrink-0 text-[10px]">{count}</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ─── Main Component ─────────────────────────────────────────────────

function LibraryPage() {
	const navigate = useNavigate();
	const songs = useQuery(api.songs.listAll);
	const playlists = useQuery(api.playlists.listAll);

	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
	const [detailSongId, setDetailSongId] = useState<string | null>(null);
	const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

	const { currentSongId } = useStore(playerStore);

	// Debounce search
	const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => {
		searchTimerRef.current = setTimeout(() => setDebouncedSearch(search), 300);
		return () => clearTimeout(searchTimerRef.current);
	}, [search]);

	// Playlist ID → name map
	const playlistMap = useMemo(() => {
		const map = new Map<string, string>();
		if (playlists) {
			for (const s of playlists) {
				map.set(s._id, s.name || s._id);
			}
		}
		return map;
	}, [playlists]);

	// Extract unique filter options from all songs
	const filterOptions = useMemo(() => {
		if (!songs)
			return {
				genres: [],
				moods: [],
				energies: [],
				eras: [],
				languages: [],
				playlists: [],
			};
		return {
			genres: unique(songs.map((s) => s.genre)),
			moods: unique(songs.map((s) => s.mood)),
			energies: unique(songs.map((s) => s.energy)),
			eras: unique(songs.map((s) => s.era)),
			languages: unique(songs.map((s) => s.language)),
			playlists: unique(
				songs
					.map(
						(s) =>
							playlistMap.get(s.playlistId as string) ||
							(s.playlistId as string),
					)
					.filter(Boolean),
			),
		};
	}, [songs, playlistMap]);

	// Filter + search
	const filtered = useMemo(() => {
		if (!songs) return [];
		return songs.filter(
			(s) =>
				matchesSearch(s, debouncedSearch) &&
				matchesFilters(s, filters, playlistMap),
		);
	}, [songs, debouncedSearch, filters, playlistMap]);

	// Counts per filter value (based on search + other filters, not this filter)
	const filterCounts = useMemo(() => {
		if (!songs)
			return {
				genres: new Map(),
				moods: new Map(),
				energies: new Map(),
				eras: new Map(),
				languages: new Map(),
				ratings: new Map(),
				playlists: new Map(),
			};

		function countFor(
			key: keyof Filters,
			valueExtractor: (s: Record<string, unknown>) => string | undefined | null,
		) {
			const otherFilters = { ...filters, [key]: [] };
			const base = (songs ?? []).filter(
				(s) =>
					matchesSearch(s, debouncedSearch) &&
					matchesFilters(s, otherFilters, playlistMap),
			);
			const counts = new Map<string, number>();
			for (const s of base) {
				const val = valueExtractor(s);
				if (val) counts.set(val, (counts.get(val) ?? 0) + 1);
			}
			return counts;
		}

		return {
			genres: countFor("genres", (s) => s.genre as string | undefined),
			moods: countFor("moods", (s) => s.mood as string | undefined),
			energies: countFor("energies", (s) => s.energy as string | undefined),
			eras: countFor("eras", (s) => s.era as string | undefined),
			languages: countFor("languages", (s) => s.language as string | undefined),
			ratings: countFor("ratings", (s) =>
				s.userRating === "up"
					? "liked"
					: s.userRating === "down"
						? "disliked"
						: "unrated",
			),
			playlists: countFor(
				"playlists",
				(s) =>
					playlistMap.get(s.playlistId as string) || (s.playlistId as string),
			),
		};
	}, [songs, debouncedSearch, filters, playlistMap]);

	const toggleFilter = useCallback((key: keyof Filters, value: string) => {
		setFilters((prev) => {
			const arr = prev[key] as string[];
			return {
				...prev,
				[key]: arr.includes(value)
					? arr.filter((v) => v !== value)
					: [...arr, value],
			};
		});
	}, []);

	const clearFilters = useCallback(() => {
		setFilters(EMPTY_FILTERS);
		setSearch("");
	}, []);

	const hasActiveFilters =
		search || Object.values(filters).some((arr) => arr.length > 0);

	const currentSong = useMemo(() => {
		if (!currentSongId || !songs) return null;
		return songs.find((s) => s._id === currentSongId) ?? null;
	}, [currentSongId, songs]);

	const handlePlaySong = useCallback((song: Record<string, unknown>) => {
		if (!song.audioUrl) return;
		const audio = getGlobalAudio();
		setCurrentSong(song._id as string);
		audio.src = song.audioUrl as string;
		audio.load();
		audio
			.play()
			.then(() => setPlaying(true))
			.catch(() => {});
		if (audio.duration && !Number.isNaN(audio.duration)) {
			setDuration(audio.duration);
		}
	}, []);

	// Loading
	if (songs === undefined) {
		return <div className="font-mono min-h-screen bg-gray-950" />;
	}

	const activeFilterCount =
		Object.values(filters).reduce((sum, arr) => sum + arr.length, 0) +
		(search ? 1 : 0);

	const filterSidebar = (
		<div className="space-y-0">
			{/* Search */}
			<div className="border-b-2 border-white/10 p-3">
				<div className="relative">
					<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
					<input
						type="text"
						className="w-full bg-gray-900 border-2 border-white/20 pl-8 pr-8 py-2 text-xs font-bold uppercase text-white placeholder:text-white/20 focus:outline-none focus:border-white/40"
						placeholder="SEARCH SONGS..."
						value={search}
						onChange={(e) => setSearch(e.target.value.toUpperCase())}
					/>
					{search && (
						<button
							type="button"
							className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
							onClick={() => setSearch("")}
						>
							<XIcon size={14} />
						</button>
					)}
				</div>
			</div>

			<FilterSection
				title="GENRE"
				options={filterOptions.genres}
				selected={filters.genres}
				onToggle={(v) => toggleFilter("genres", v)}
				counts={filterCounts.genres}
			/>
			<FilterSection
				title="MOOD"
				options={filterOptions.moods}
				selected={filters.moods}
				onToggle={(v) => toggleFilter("moods", v)}
				counts={filterCounts.moods}
			/>
			<FilterSection
				title="ENERGY"
				options={filterOptions.energies}
				selected={filters.energies}
				onToggle={(v) => toggleFilter("energies", v)}
				counts={filterCounts.energies}
			/>
			<FilterSection
				title="ERA"
				options={filterOptions.eras}
				selected={filters.eras}
				onToggle={(v) => toggleFilter("eras", v)}
				counts={filterCounts.eras}
			/>
			<FilterSection
				title="LANGUAGE"
				options={filterOptions.languages}
				selected={filters.languages}
				onToggle={(v) => toggleFilter("languages", v)}
				counts={filterCounts.languages}
			/>
			<FilterSection
				title="RATING"
				options={["liked", "disliked", "unrated"]}
				selected={filters.ratings}
				onToggle={(v) => toggleFilter("ratings", v)}
				counts={filterCounts.ratings}
			/>
			<FilterSection
				title="PLAYLIST"
				options={filterOptions.playlists}
				selected={filters.playlists}
				onToggle={(v) => toggleFilter("playlists", v)}
				counts={filterCounts.playlists}
			/>

			{hasActiveFilters && (
				<div className="p-3">
					<button
						type="button"
						className="w-full border-2 border-red-500/40 px-3 py-2 text-xs font-black uppercase text-red-500 hover:bg-red-500 hover:text-black transition-colors"
						onClick={clearFilters}
					>
						CLEAR ALL
					</button>
				</div>
			)}
		</div>
	);

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex flex-col">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black shrink-0">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-white"
							onClick={() => navigate({ to: "/autoplayer" })}
						>
							<ArrowBackIcon size={20} />
						</button>
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							LIBRARY
						</h1>
					</div>
					<div className="flex items-center gap-3">
						{/* Mobile filter toggle */}
						<button
							type="button"
							className="md:hidden flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-white"
							onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
						>
							<SlidersHorizontal className="h-4 w-4" />
							{activeFilterCount > 0 && (
								<span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5">
									{activeFilterCount}
								</span>
							)}
						</button>
						<span className="text-xs uppercase tracking-widest text-white/30">
							{filtered.length} / {songs.length} SONGS
						</span>
					</div>
				</div>
				<MiniPlayer currentSong={currentSong} />
			</header>

			{/* MAIN */}
			<div className="flex flex-1 overflow-hidden">
				{/* Filter sidebar — desktop */}
				<aside className="hidden md:block w-64 shrink-0 border-r-4 border-white/20 bg-black overflow-y-auto">
					{filterSidebar}
				</aside>

				{/* Mobile filter overlay */}
				{mobileFiltersOpen && (
					<div className="fixed inset-0 z-40 md:hidden">
						{/* biome-ignore lint/a11y/useSemanticElements: backdrop overlay dismiss area */}
						<div
							role="button"
							tabIndex={0}
							className="absolute inset-0 bg-black/80"
							onClick={() => setMobileFiltersOpen(false)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									setMobileFiltersOpen(false);
								}
							}}
						/>
						<div className="absolute left-0 top-0 bottom-0 w-72 bg-gray-950 border-r-4 border-white/20 overflow-y-auto z-50">
							<div className="border-b-4 border-white/20 px-3 py-3 flex items-center justify-between bg-black">
								<span className="text-sm font-black uppercase tracking-widest">
									FILTERS
								</span>
								<button
									type="button"
									className="text-white/60 hover:text-white"
									onClick={() => setMobileFiltersOpen(false)}
								>
									<XIcon size={20} />
								</button>
							</div>
							{filterSidebar}
						</div>
					</div>
				)}

				{/* Song grid */}
				<main className="flex-1 overflow-y-auto">
					{filtered.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-4">
							<VinylIcon size={64} className="text-white/10 mb-4" />
							<p className="text-lg font-black uppercase text-white/30">
								{songs.length === 0 ? "NO SONGS YET" : "NO MATCHES"}
							</p>
							<p className="text-xs uppercase tracking-wider text-white/15 mt-2">
								{songs.length === 0
									? "START A PLAYLIST TO GENERATE MUSIC"
									: "TRY DIFFERENT FILTERS OR SEARCH TERMS"}
							</p>
						</div>
					) : (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
							{filtered.map((song) => {
								const isCurrent = song._id === currentSongId;
								const isPlayable = !!song.audioUrl;
								return (
									<div
										key={song._id}
										className={`border-r-2 border-b-2 border-white/10 transition-colors ${
											isCurrent ? "bg-red-950/40" : "bg-gray-950"
										}`}
									>
										{/* Cover — click to play */}
										{/* biome-ignore lint/a11y/useSemanticElements: div wraps cover art with overlay */}
										<div
											role="button"
											tabIndex={0}
											className={`relative ${isPlayable ? "cursor-pointer" : "opacity-50"}`}
											onClick={() => isPlayable && handlePlaySong(song)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													if (isPlayable) handlePlaySong(song);
												}
											}}
										>
											<CoverArt
												title={song.title || "..."}
												artistName={song.artistName || "..."}
												coverUrl={song.coverUrl}
												size="sm"
											/>
											{isCurrent && (
												<div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white text-center text-[10px] font-black py-1 uppercase">
													NOW PLAYING
												</div>
											)}
										</div>
										{/* Info — click to open detail */}
										{/* biome-ignore lint/a11y/useSemanticElements: div wraps song info with genre badge */}
										<div
											role="button"
											tabIndex={0}
											className="p-2 cursor-pointer hover:bg-gray-900 transition-colors"
											onClick={() => setDetailSongId(song._id)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													setDetailSongId(song._id);
												}
											}}
										>
											<p className="text-xs font-black uppercase truncate">
												{song.title || "..."}
											</p>
											<p className="text-[10px] uppercase text-white/30 truncate">
												{song.artistName || "..."}
											</p>
											{song.genre && (
												<span className="inline-block mt-1 border border-white/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-white/40 truncate max-w-full">
													{song.genre}
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</main>
			</div>

			{/* FOOTER */}
			<footer className="bg-black px-4 py-2 border-t-4 border-white/20 shrink-0">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span>{"LIBRARY // ALL PLAYLISTS"}</span>
					<span className="flex items-center gap-2">
						<VinylIcon size={12} />
						{filtered.length} SHOWN / {songs.length} TOTAL
					</span>
				</div>
			</footer>

			{/* TRACK DETAIL MODAL */}
			{detailSongId &&
				songs &&
				(() => {
					const detailSong = songs.find((s) => s._id === detailSongId);
					if (!detailSong) return null;
					return (
						<TrackDetail
							song={detailSong}
							onClose={() => setDetailSongId(null)}
							onDeleted={() => setDetailSongId(null)}
						/>
					);
				})()}
		</div>
	);
}
