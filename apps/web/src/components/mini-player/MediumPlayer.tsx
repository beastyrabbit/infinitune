import type {
	Device,
	PlaybackState,
	SongData,
} from "@infinitune/shared/protocol";
import { Pause, Play, SkipForward, ThumbsDown } from "lucide-react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { Button } from "@/components/ui/button";
import LikeIcon from "@/components/ui/like-icon";
import Volume2Icon from "@/components/ui/volume-2-icon";
import VolumeXIcon from "@/components/ui/volume-x-icon";
import { formatTime } from "@/lib/format-time";
import { RoomBadge } from "./RoomBadge";

interface MediumPlayerProps {
	song: SongData | null;
	playback: PlaybackState;
	devices: Device[];
	roomName: string;
	connected: boolean;
	onToggle: () => void;
	onSkip: () => void;
	onSeek: (time: number) => void;
	onSetVolume: (volume: number) => void;
	onToggleMute: () => void;
	onRate: (songId: string, rating: "up" | "down") => void;
}

export function MediumPlayer({
	song,
	playback,
	devices,
	roomName,
	connected,
	onToggle,
	onSkip,
	onSeek,
	onSetVolume,
	onToggleMute,
	onRate,
}: MediumPlayerProps) {
	const progress =
		playback.duration > 0
			? (playback.currentTime / playback.duration) * 100
			: 0;

	return (
		<div className="flex flex-col h-full bg-black text-white overflow-hidden">
			{/* Room badge */}
			<div className="flex-shrink-0 px-4 py-2 border-b border-white/10">
				<RoomBadge
					roomName={roomName}
					devices={devices}
					connected={connected}
				/>
			</div>

			{/* Cover art + metadata */}
			<div className="flex-1 flex flex-col items-center justify-center px-4 py-4 min-h-0">
				{/* Cover */}
				<div className="w-full max-w-[200px] aspect-square">
					{song?.title ? (
						<CoverArt
							title={song.title}
							artistName={song.artistName ?? ""}
							coverUrl={song.coverUrl}
							size="md"
							spinning={playback.isPlaying}
						/>
					) : (
						<div className="w-full h-full bg-white/5 flex items-center justify-center">
							<span className="text-white/20 font-black uppercase text-sm">
								No Track
							</span>
						</div>
					)}
				</div>

				{/* Metadata */}
				{song?.title && (
					<div className="mt-3 text-center w-full">
						<h2 className="text-lg font-black uppercase truncate">
							{song.title}
						</h2>
						<p className="text-sm text-white/60 truncate">{song.artistName}</p>
						<p className="text-xs text-white/30 uppercase mt-0.5">
							{song.subGenre || song.genre}
							{song.bpm ? ` — ${song.bpm} BPM` : ""}
						</p>
					</div>
				)}
			</div>

			{/* Progress bar */}
			<div className="flex-shrink-0 px-4">
				<div className="flex items-center justify-between text-xs font-bold text-white/50 mb-1">
					<span>{formatTime(playback.currentTime)}</span>
					<span>{formatTime(playback.duration)}</span>
				</div>
				<div
					role="slider"
					tabIndex={0}
					aria-label="Seek"
					aria-valuenow={Math.round(progress)}
					aria-valuemin={0}
					aria-valuemax={100}
					className="h-2 border border-white/20 bg-white/5 cursor-pointer"
					onClick={(e) => {
						const rect = e.currentTarget.getBoundingClientRect();
						const pct = (e.clientX - rect.left) / rect.width;
						onSeek(pct * playback.duration);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowRight") {
							e.preventDefault();
							onSeek(Math.min(playback.duration, playback.currentTime + 5));
						} else if (e.key === "ArrowLeft") {
							e.preventDefault();
							onSeek(Math.max(0, playback.currentTime - 5));
						}
					}}
				>
					<div
						className="h-full bg-red-500 transition-all"
						style={{ width: `${progress}%` }}
					/>
				</div>
			</div>

			{/* Controls */}
			<div className="flex-shrink-0 px-4 py-3 flex items-center gap-2">
				<Button
					variant="outline"
					onClick={onToggle}
					className="h-9 rounded-none border-2 border-white/30 bg-white/10 font-mono text-xs font-black uppercase text-white hover:bg-red-500 hover:border-red-500"
				>
					{playback.isPlaying ? (
						<Pause className="h-4 w-4" />
					) : (
						<Play className="h-4 w-4" />
					)}
				</Button>
				<Button
					variant="outline"
					onClick={onSkip}
					className="h-9 rounded-none border-2 border-white/30 bg-white/10 font-mono text-xs font-black uppercase text-white hover:bg-white hover:text-black"
				>
					<SkipForward className="h-4 w-4" />
				</Button>

				{/* Rating */}
				{song && (
					<>
						<Button
							variant="outline"
							onClick={() => onRate(song._id, "up")}
							className={`h-9 rounded-none border-2 font-mono text-xs font-black uppercase ${
								song.userRating === "up"
									? "border-green-500 bg-green-500/20 text-green-400"
									: "border-white/30 bg-white/10 text-white hover:bg-green-500/20 hover:text-green-400 hover:border-green-500"
							}`}
						>
							<LikeIcon size={14} />
						</Button>
						<Button
							variant="outline"
							onClick={() => onRate(song._id, "down")}
							className={`h-9 rounded-none border-2 font-mono text-xs font-black uppercase ${
								song.userRating === "down"
									? "border-red-500 bg-red-500/20 text-red-400"
									: "border-white/30 bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400 hover:border-red-500"
							}`}
						>
							<ThumbsDown className="h-3.5 w-3.5" />
						</Button>
					</>
				)}

				{/* Volume */}
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={onToggleMute}
						className="text-white/60 hover:text-white"
					>
						{playback.isMuted ? (
							<VolumeXIcon size={14} />
						) : (
							<Volume2Icon size={14} />
						)}
					</button>
					<div
						role="slider"
						tabIndex={0}
						aria-label="Volume"
						aria-valuenow={Math.round(
							(playback.isMuted ? 0 : playback.volume) * 100,
						)}
						aria-valuemin={0}
						aria-valuemax={100}
						className="h-2 w-16 border border-white/20 bg-white/5 cursor-pointer"
						onClick={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							const pct = Math.max(
								0,
								Math.min(1, (e.clientX - rect.left) / rect.width),
							);
							onSetVolume(pct);
						}}
						onKeyDown={(e) => {
							if (e.key === "ArrowRight") {
								e.preventDefault();
								onSetVolume(Math.min(1, playback.volume + 0.05));
							} else if (e.key === "ArrowLeft") {
								e.preventDefault();
								onSetVolume(Math.max(0, playback.volume - 0.05));
							}
						}}
					>
						<div
							className="h-full bg-white"
							style={{
								width: `${(playback.isMuted ? 0 : playback.volume) * 100}%`,
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
