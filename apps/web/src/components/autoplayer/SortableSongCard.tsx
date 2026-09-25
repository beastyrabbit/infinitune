import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SongStatus } from "@infinitune/shared/types";
import { Loader2, ThumbsDown } from "lucide-react";
import LikeIcon from "@/components/ui/like-icon";
import {
	formatElapsed,
	isGenerating as isGeneratingStatus,
	isPlayable as isPlayableStatus,
} from "@/lib/format-time";
import { getStatusBadge } from "@/lib/song-status";
import type { Song } from "@/types";
import { CoverArt } from "./CoverArt";
import { LiveTimer } from "./LiveTimer";

interface SortableSongCardProps {
	song: Song;
	isCurrent: boolean;
	isOldEpoch: boolean;
	onSelectSong: (songId: string) => void;
	onOpenDetail: (songId: string) => void;
	onRate: (songId: string, rating: "up" | "down") => void;
}

const GENERATING_STATUS_LABELS: Partial<Record<SongStatus, string>> = {
	pending: "QUEUED",
	generating_metadata: "WRITING",
	metadata_ready: "READY",
	submitting_to_ace: "SUBMITTING",
	generating_audio: "AUDIO",
	saving: "SAVING",
};

function getCardBorderClass(
	isInterruptGenerating: boolean | null,
	isInterruptReady: boolean | null,
): string {
	if (isInterruptGenerating) return "border-2 border-cyan-400 animate-pulse";
	if (isInterruptReady) return "border-2 border-green-400";
	return "";
}

function getOrderBadgeClass(
	isInterruptGenerating: boolean | null,
	isInterruptReady: boolean | null,
	isOldEpoch: boolean,
): string {
	if (isInterruptGenerating) return "bg-cyan-400 text-black";
	if (isInterruptReady) return "bg-green-400 text-black";
	if (isOldEpoch) return "bg-white/20 text-white/40";
	return "bg-white text-black";
}

function getOrderBadgeLabel(
	isInterruptGenerating: boolean | null,
	isInterruptReady: boolean | null,
	cardNum: number,
): string {
	if (isInterruptGenerating) return "[!]";
	if (isInterruptReady) return "[NEXT]";
	return String(cardNum).padStart(2, "0");
}

function CoverStatusBanners({
	status,
	isCurrent,
	isGenerating,
}: Readonly<{
	status: SongStatus;
	isCurrent: boolean;
	isGenerating: boolean;
}>) {
	return (
		<>
			{isCurrent && (
				<div className="absolute bottom-0 left-0 right-0 bg-red-500 text-white text-center text-xs font-black py-1 uppercase">
					&#9654; NOW PLAYING
				</div>
			)}
			{isGenerating && (
				<div className="absolute bottom-0 left-0 right-0 bg-yellow-500 text-black text-center text-xs font-black py-1 uppercase flex items-center justify-center gap-1">
					<Loader2 className="h-3 w-3 animate-spin" />
					{GENERATING_STATUS_LABELS[status] ?? "GENERATING"}
				</div>
			)}
			{status === "retry_pending" && (
				<div className="absolute bottom-0 left-0 right-0 bg-orange-500 text-black text-center text-xs font-black py-1 uppercase">
					RETRY PENDING
				</div>
			)}
			{status === "error" && (
				<div className="absolute bottom-0 left-0 right-0 bg-red-600 text-white text-center text-xs font-black py-1 uppercase">
					ERROR
				</div>
			)}
		</>
	);
}

function SongRatingButtons({
	song,
	onRate,
}: Readonly<{
	song: Song;
	onRate: (songId: string, rating: "up" | "down") => void;
}>) {
	return (
		<>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onRate(song.id, "up");
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
					onRate(song.id, "down");
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
	);
}

function SongCardInfo({
	song,
	isOldEpoch,
	isReady,
	isGenerating,
	status,
	totalGenTime,
	onRate,
}: Readonly<{
	song: Song;
	isOldEpoch: boolean;
	isReady: boolean;
	isGenerating: boolean;
	status: { text: string; className: string };
	totalGenTime: number | null;
	onRate: (songId: string, rating: "up" | "down") => void;
}>) {
	const totalGenTimeLabel = totalGenTime ? formatElapsed(totalGenTime) : null;

	return (
		<>
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
					{isReady && <SongRatingButtons song={song} onRate={onRate} />}
					{(song.listenCount ?? 0) > 0 && (
						<span className="text-[10px] text-white/30">
							{song.listenCount}x
						</span>
					)}
				</div>
				<p className="text-[10px] uppercase text-white/20">
					{isGenerating && song.generationStartedAt ? (
						<LiveTimer startedAt={song.generationStartedAt} />
					) : (
						totalGenTimeLabel
					)}
				</p>
			</div>
		</>
	);
}

export function SortableSongCard({
	song,
	isCurrent,
	isOldEpoch,
	onSelectSong,
	onOpenDetail,
	onRate,
}: SortableSongCardProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: song.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : undefined,
	};

	const isPlayable = isPlayableStatus(song.status);
	const isGenerating = isGeneratingStatus(song.status);
	const isReady = isPlayable || isCurrent;
	const status = getStatusBadge(song.status, isCurrent);

	const isInterruptGenerating = song.isInterrupt && isGenerating;
	const isInterruptReady = song.isInterrupt && song.status === "ready";

	const totalGenTime =
		song.generationStartedAt && song.generationCompletedAt
			? song.generationCompletedAt - song.generationStartedAt
			: null;

	const cardBorderClass = getCardBorderClass(
		isInterruptGenerating,
		isInterruptReady,
	);

	const cardNum = Math.round(song.orderIndex);

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			className={`relative border-r-4 border-b-4 border-white/10 transition-colors ${
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
					if (isPlayable) onSelectSong(song.id);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						if (isPlayable) onSelectSong(song.id);
					}
				}}
			>
				<CoverArt
					title={song.title || "Generating..."}
					artistName={song.artistName || "..."}
					cover={song.cover}
					size="sm"
				/>
				<div
					ref={setActivatorNodeRef}
					{...listeners}
					className={`absolute top-0 left-0 text-xs font-black px-2 py-1 cursor-grab active:cursor-grabbing z-10 ${getOrderBadgeClass(
						isInterruptGenerating,
						isInterruptReady,
						isOldEpoch,
					)}`}
				>
					{getOrderBadgeLabel(isInterruptGenerating, isInterruptReady, cardNum)}
				</div>
				<CoverStatusBanners
					status={song.status}
					isCurrent={isCurrent}
					isGenerating={isGenerating}
				/>
			</div>
			{/* Title/info — click to open detail */}
			{/* biome-ignore lint/a11y/useSemanticElements: div wraps complex layout children unsuitable for button */}
			<div
				role="button"
				tabIndex={0}
				className="p-2 cursor-pointer hover:bg-gray-900 transition-colors"
				onClick={() => onOpenDetail(song.id)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onOpenDetail(song.id);
					}
				}}
			>
				<SongCardInfo
					song={song}
					isOldEpoch={isOldEpoch}
					isReady={isReady}
					isGenerating={isGenerating}
					status={status}
					totalGenTime={totalGenTime}
					onRate={onRate}
				/>
			</div>
		</div>
	);
}
