import type { PlaybackState, SongData } from "@infinitune/shared/protocol";
import { Pause, Play, SkipForward } from "lucide-react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { formatTime } from "@/lib/format-time";

interface CompactBarProps {
	song: SongData | null;
	playback: PlaybackState;
	onToggle: () => void;
	onSkip: () => void;
}

export function CompactBar({
	song,
	playback,
	onToggle,
	onSkip,
}: CompactBarProps) {
	const progress =
		playback.duration > 0
			? (playback.currentTime / playback.duration) * 100
			: 0;

	return (
		<div className="flex items-center gap-3 h-full px-3 bg-black border-t border-white/10">
			{/* Cover thumbnail */}
			<div className="h-10 w-10 flex-shrink-0 overflow-hidden">
				{song?.title ? (
					<CoverArt
						title={song.title}
						artistName={song.artistName ?? ""}
						coverUrl={song.coverUrl}
						size="sm"
					/>
				) : (
					<div className="h-full w-full bg-white/5" />
				)}
			</div>

			{/* Title + Artist */}
			<div className="flex-1 min-w-0">
				<p className="text-sm font-black uppercase truncate leading-tight">
					{song?.title ?? "No track"}
				</p>
				<p className="text-xs text-white/50 truncate">
					{song?.artistName ?? "—"}
				</p>
			</div>

			{/* Play/Pause */}
			<button
				type="button"
				onClick={onToggle}
				className="flex-shrink-0 h-8 w-8 flex items-center justify-center border border-white/30 hover:bg-red-500 hover:border-red-500 transition-colors"
			>
				{playback.isPlaying ? <Pause size={14} /> : <Play size={14} />}
			</button>

			{/* Skip */}
			<button
				type="button"
				onClick={onSkip}
				className="flex-shrink-0 h-8 w-8 flex items-center justify-center border border-white/30 hover:bg-white/20 transition-colors"
			>
				<SkipForward size={14} />
			</button>

			{/* Mini progress bar */}
			<div className="flex-shrink-0 w-16 flex items-center gap-1">
				<div className="h-1 flex-1 bg-white/10">
					<div
						className="h-full bg-red-500 transition-all"
						style={{ width: `${progress}%` }}
					/>
				</div>
				<span className="text-[10px] font-mono text-white/40">
					{formatTime(playback.currentTime)}
				</span>
			</div>
		</div>
	);
}
