import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { OneshotPhase } from "@/hooks/useOneshot";
import { formatTime } from "@/lib/format-time";
import { setVolume, toggleMute } from "@/lib/player-store";

/** Footer status label shared by the oneshot and reimagine pages. */
export function oneshotPhaseLabel(phase: OneshotPhase): string {
	if (phase === "idle") return "READY";
	if (phase === "ready") return "COMPLETE";
	return phase.toUpperCase();
}

/** Play/pause button and seek bar for a oneshot result. */
export function OneshotTransport({
	isCurrentSong,
	isPlaying,
	currentTime,
	audioDuration,
	onPlayPause,
	onSeek,
	playButtonClassName,
	progressBarClassName,
}: {
	isCurrentSong: boolean | null;
	isPlaying: boolean;
	currentTime: number;
	audioDuration: number;
	onPlayPause: () => void;
	onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
	playButtonClassName: string;
	progressBarClassName: string;
}) {
	const progress =
		audioDuration > 0 && isCurrentSong
			? (currentTime / audioDuration) * 100
			: 0;

	return (
		<div className="flex items-center gap-3">
			<button
				type="button"
				className={playButtonClassName}
				onClick={onPlayPause}
			>
				{isCurrentSong && isPlaying ? (
					<Pause className="h-4 w-4" />
				) : (
					<Play className="h-4 w-4" />
				)}
			</button>

			<div className="flex-1 flex items-center gap-2">
				<span className="text-[10px] font-bold text-white/40 shrink-0 w-8 text-right">
					{isCurrentSong ? formatTime(currentTime) : "0:00"}
				</span>
				{/* biome-ignore lint/a11y/useSemanticElements: div used for custom seek bar */}
				<div
					role="button"
					tabIndex={0}
					className="flex-1 h-2 border-2 border-white/20 bg-black cursor-pointer"
					onClick={onSeek}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
						}
					}}
				>
					<div
						className={progressBarClassName}
						style={{ width: `${progress}%` }}
					/>
				</div>
				<span className="text-[10px] font-bold text-white/40 shrink-0 w-8">
					{isCurrentSong && audioDuration > 0
						? formatTime(audioDuration)
						: "--:--"}
				</span>
			</div>
		</div>
	);
}

/** Mute toggle and volume bar for a oneshot result. */
export function OneshotVolume({
	volume,
	isMuted,
}: {
	volume: number;
	isMuted: boolean;
}) {
	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={toggleMute}
				className="text-white/50 hover:text-white transition-colors"
			>
				{isMuted ? (
					<VolumeX className="h-3.5 w-3.5" />
				) : (
					<Volume2 className="h-3.5 w-3.5" />
				)}
			</button>
			{/* biome-ignore lint/a11y/useSemanticElements: div used for custom volume bar */}
			<div
				role="button"
				tabIndex={0}
				className="h-1.5 w-16 border border-white/20 bg-black cursor-pointer"
				onClick={(e) => {
					const rect = e.currentTarget.getBoundingClientRect();
					const pct = Math.max(
						0,
						Math.min(1, (e.clientX - rect.left) / rect.width),
					);
					setVolume(pct);
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") e.preventDefault();
				}}
			>
				<div
					className="h-full bg-white"
					style={{
						width: `${(isMuted ? 0 : volume) * 100}%`,
					}}
				/>
			</div>
		</div>
	);
}
