import { Loader2, ThumbsDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import LikeIcon from "@/components/ui/like-icon";
import type { Song } from "@/types/convex";
import type { SongStatus } from "../../../convex/types";
import { CoverArt } from "./CoverArt";

interface QueueGridProps {
	songs: Song[];
	currentSongId: string | null;
	playlistEpoch: number;
	transitionComplete: boolean;
	onSelectSong: (songId: string) => void;
	onOpenDetail: (songId: string) => void;
	onRate: (songId: string, rating: "up" | "down") => void;
}

function getStatusLabel(status: SongStatus, isCurrent: boolean) {
	if (isCurrent)
		return { text: "[PLAYING]", className: "text-red-500 font-black" };
	switch (status) {
		case "ready":
			return { text: "[READY]", className: "text-white font-bold" };
		case "pending":
			return {
				text: "[QUEUED]",
				className: "text-blue-400 animate-pulse font-bold",
			};
		case "generating_metadata":
			return {
				text: "[WRITING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "metadata_ready":
			return { text: "[METADATA OK]", className: "text-cyan-400 font-bold" };
		case "submitting_to_ace":
			return {
				text: "[SUBMITTING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "generating_audio":
			return {
				text: "[GENERATING AUDIO...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "saving":
			return {
				text: "[SAVING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "played":
			return { text: "[READY]", className: "text-white/50 font-bold" };
		case "retry_pending":
			return {
				text: "[RETRY PENDING]",
				className: "text-orange-400 font-bold",
			};
		case "error":
			return { text: "[ERROR]", className: "text-red-400 font-bold" };
	}
}

function formatElapsed(ms: number) {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${m}m${s}s`;
}

function LiveTimer({ startedAt }: { startedAt: number }) {
	const [elapsed, setElapsed] = useState(Date.now() - startedAt);

	useEffect(() => {
		const interval = setInterval(() => {
			setElapsed(Date.now() - startedAt);
		}, 1000);
		return () => clearInterval(interval);
	}, [startedAt]);

	return <>{formatElapsed(elapsed)}</>;
}

export function QueueGrid({
	songs,
	currentSongId,
	playlistEpoch,
	transitionComplete,
	onSelectSong,
	onOpenDetail,
	onRate,
}: QueueGridProps) {
	// Sort: current-epoch songs first, then older epochs; within same epoch by orderIndex
	const sorted = [...songs].sort((a, b) => {
		const aEpoch = a.promptEpoch ?? 0;
		const bEpoch = b.promptEpoch ?? 0;
		if (aEpoch !== bEpoch) return bEpoch - aEpoch; // higher epoch first
		return a.orderIndex - b.orderIndex;
	});

	const activeStatuses: SongStatus[] = [
		"pending",
		"generating_metadata",
		"metadata_ready",
		"submitting_to_ace",
		"generating_audio",
		"saving",
	];
	const generating = sorted.filter((s) =>
		activeStatuses.includes(s.status),
	).length;
	const retryPending = sorted.filter(
		(s) => s.status === "retry_pending",
	).length;

	// Epoch-aware stats
	const readySongs = sorted.filter(
		(s) => s.status === "ready" || s.status === "played",
	);
	const newDirReady = readySongs.filter(
		(s) => (s.promptEpoch ?? 0) === playlistEpoch,
	).length;
	const fillerReady = readySongs.filter(
		(s) => (s.promptEpoch ?? 0) !== playlistEpoch,
	).length;
	const hasInterruptPending = sorted.some(
		(s) => s.isInterrupt && activeStatuses.includes(s.status),
	);

	// Build items with epoch dividers
	const items: ReactNode[] = [];
	let lastEpoch: number | null = null;

	for (const song of sorted) {
		const songEpoch = song.promptEpoch ?? 0;

		// Insert epoch divider when crossing epoch boundaries
		if (playlistEpoch > 0 && lastEpoch !== null && songEpoch !== lastEpoch) {
			items.push(
				<div
					key={`divider-${songEpoch}-${song._id}`}
					className="col-span-full border-t-4 border-cyan-500/30 flex items-center justify-center py-1.5 bg-black/50"
				>
					<span className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/60">
						{"──── >>> STEER ──── EPOCH "}
						{songEpoch}
						{" ────"}
					</span>
				</div>,
			);
		}
		lastEpoch = songEpoch;

		const isCurrent = song._id === currentSongId;
		const isPlayable = song.status === "ready" || song.status === "played";
		const isGenerating =
			song.status === "pending" ||
			song.status.startsWith("generating") ||
			song.status === "metadata_ready" ||
			song.status === "submitting_to_ace" ||
			song.status === "saving";
		const isReady =
			song.status === "ready" || song.status === "played" || isCurrent;
		const status = getStatusLabel(song.status, isCurrent);

		const isOldEpoch =
			!transitionComplete &&
			playlistEpoch > 0 &&
			songEpoch < playlistEpoch &&
			!isCurrent;
		const isInterruptGenerating = song.isInterrupt && isGenerating;
		const isInterruptReady = song.isInterrupt && song.status === "ready";

		const totalGenTime =
			song.generationStartedAt && song.generationCompletedAt
				? song.generationCompletedAt - song.generationStartedAt
				: null;

		// Card border classes for interrupt highlighting
		let cardBorderClass = "";
		if (isInterruptGenerating) {
			cardBorderClass = "border-2 border-cyan-400 animate-pulse";
		} else if (isInterruptReady) {
			cardBorderClass = "border-2 border-green-400";
		}

		const cardNum = Math.round(song.orderIndex);

		items.push(
			<div
				key={song._id}
				className={`border-r-4 border-b-4 border-white/10 transition-colors ${
					isCurrent ? "bg-red-950/40" : "bg-gray-950"
				} ${cardBorderClass}`}
			>
				{/* Cover art — click to play */}
				{/* biome-ignore lint/a11y/useSemanticElements: div wraps complex layout children unsuitable for button */}
				<div
					role="button"
					tabIndex={0}
					className={`relative ${isPlayable ? "cursor-pointer" : ""} ${!isReady ? "grayscale" : ""} ${isOldEpoch ? "grayscale opacity-40" : ""} transition-[filter] duration-500`}
					onClick={() => {
						if (isPlayable) onSelectSong(song._id);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							if (isPlayable) onSelectSong(song._id);
						}
					}}
				>
					<CoverArt
						title={song.title || "Generating..."}
						artistName={song.artistName || "..."}
						coverUrl={song.coverUrl}
						size="sm"
					/>
					<div
						className={`absolute top-0 left-0 text-xs font-black px-2 py-1 ${
							isInterruptGenerating
								? "bg-cyan-400 text-black"
								: isInterruptReady
									? "bg-green-400 text-black"
									: isOldEpoch
										? "bg-white/20 text-white/40"
										: "bg-white text-black"
						}`}
					>
						{isInterruptGenerating
							? "[!]"
							: isInterruptReady
								? "[NEXT]"
								: String(cardNum).padStart(2, "0")}
					</div>
					{isCurrent && (
						<div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white text-center text-xs font-black py-1 uppercase">
							&#9654; NOW PLAYING
						</div>
					)}
					{isGenerating && (
						<div className="absolute bottom-0 left-0 right-0 bg-yellow-500 text-black text-center text-xs font-black py-1 uppercase flex items-center justify-center gap-1">
							<Loader2 className="h-3 w-3 animate-spin" />
							{song.status === "pending"
								? "QUEUED"
								: song.status === "generating_metadata"
									? "WRITING"
									: song.status === "metadata_ready"
										? "READY"
										: song.status === "submitting_to_ace"
											? "SUBMITTING"
											: song.status === "generating_audio"
												? "AUDIO"
												: song.status === "saving"
													? "SAVING"
													: "GENERATING"}
						</div>
					)}
					{song.status === "retry_pending" && (
						<div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-black text-center text-xs font-black py-1 uppercase">
							RETRY PENDING
						</div>
					)}
					{song.status === "error" && (
						<div className="absolute bottom-0 left-0 right-0 bg-red-600 text-white text-center text-xs font-black py-1 uppercase">
							ERROR
						</div>
					)}
				</div>
				{/* Title/info — click to open detail */}
				{/* biome-ignore lint/a11y/useSemanticElements: div wraps complex layout children unsuitable for button */}
				<div
					role="button"
					tabIndex={0}
					className="p-2 cursor-pointer hover:bg-gray-900 transition-colors"
					onClick={() => onOpenDetail(song._id)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onOpenDetail(song._id);
						}
					}}
				>
					<p
						className={`text-xs font-black uppercase truncate ${isOldEpoch ? "text-white/30" : ""}`}
					>
						{song.title || "Generating..."}
					</p>
					<p
						className={`text-[10px] uppercase truncate ${isOldEpoch ? "text-white/20" : "text-white/30"}`}
					>
						{song.artistName || "..."}{" "}
						{song.llmProvider === "openrouter" && (
							<span className="text-blue-400">[OR]</span>
						)}
						{song.llmProvider === "ollama" && (
							<span className="text-green-400">[OL]</span>
						)}
					</p>
					<div className="flex items-center justify-between mt-1">
						<div className="flex items-center gap-1">
							<p
								className={`text-[10px] uppercase ${isOldEpoch ? "text-white/20 font-bold" : status.className}`}
							>
								{isOldEpoch ? "[FILLER]" : status.text}
							</p>
							{isReady && (
								<>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onRate(song._id, "up");
										}}
										className={`p-0.5 transition-colors ${
											song.userRating === "up"
												? "text-green-400"
												: "text-white/20 hover:text-green-400"
										}`}
									>
										<LikeIcon size={10} />
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											onRate(song._id, "down");
										}}
										className={`p-0.5 transition-colors ${
											song.userRating === "down"
												? "text-red-400"
												: "text-white/20 hover:text-red-400"
										}`}
									>
										<ThumbsDown className="h-2.5 w-2.5" />
									</button>
								</>
							)}
							{(song.listenCount ?? 0) > 0 && (
								<span className="text-[10px] text-white/30">
									{song.listenCount}x
								</span>
							)}
						</div>
						<p className="text-[10px] uppercase text-white/20">
							{isGenerating && song.generationStartedAt ? (
								<LiveTimer startedAt={song.generationStartedAt} />
							) : totalGenTime ? (
								formatElapsed(totalGenTime)
							) : null}
						</p>
					</div>
				</div>
			</div>,
		);
	}

	return (
		<div className="border-b-4 border-white/20">
			<div className="bg-black px-4 py-2 flex items-center justify-between border-b-4 border-white/20">
				<span className="text-sm font-black uppercase tracking-widest">
					QUEUE [{sorted.length} TRACKS]
				</span>
				<div className="flex gap-4 text-xs uppercase tracking-wider text-white/30">
					{hasInterruptPending && (
						<span className="text-cyan-400">1 REQUEST PENDING</span>
					)}
					{!transitionComplete && playlistEpoch > 0 ? (
						<>
							<span>{newDirReady} NEW DIR</span>
							<span>{fillerReady} FILLER</span>
						</>
					) : (
						<span>{newDirReady + fillerReady} READY</span>
					)}
					<span className="text-yellow-500">{generating} GENERATING</span>
					{retryPending > 0 && (
						<span className="text-orange-400">{retryPending} RETRY</span>
					)}
				</div>
			</div>

			<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
				{items}
			</div>
		</div>
	);
}
