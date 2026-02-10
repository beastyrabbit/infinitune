import { useStore } from "@tanstack/react-store";
import {
	Download,
	Pause,
	Play,
	SkipForward,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { playerStore, setVolume, toggleMute } from "@/lib/player-store";
import { CoverArt } from "./CoverArt";

interface Song {
	_id: string;
	title: string;
	artistName: string;
	genre: string;
	subGenre: string;
	bpm: number;
	keyScale: string;
	coverUrl?: string | null;
	audioUrl?: string | null;
	status: string;
}

interface NowPlayingProps {
	song: Song | null;
	onToggle: () => void;
	onSkip: () => void;
	onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlaying({
	song,
	onToggle,
	onSkip,
	onSeek,
}: NowPlayingProps) {
	const { isPlaying, currentTime, duration, volume, isMuted } =
		useStore(playerStore);
	const [isDownloading, setIsDownloading] = useState(false);

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	const handleDownload = useCallback(async () => {
		if (!song?.audioUrl || isDownloading) return;
		setIsDownloading(true);
		try {
			const res = await fetch(song.audioUrl);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${song.title} - ${song.artistName}.mp3`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} finally {
			setIsDownloading(false);
		}
	}, [song, isDownloading]);

	if (!song) {
		return (
			<div className="flex items-center justify-center p-12 bg-gray-950">
				<span className="text-xl font-black uppercase text-white/20">
					NO TRACK LOADED
				</span>
			</div>
		);
	}

	return (
		<div>
			{/* Overlay container — cover art as background, controls on top */}
			<div className="relative aspect-[2/1] md:aspect-[3/1] overflow-hidden">
				{/* Cover art background */}
				<div className="absolute inset-0">
					<CoverArt
						title={song.title}
						artistName={song.artistName}
						coverUrl={song.coverUrl}
						size="lg"
						fill
					/>
				</div>

				{/* Gradient overlay for readability */}
				<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

				{/* Top info overlay */}
				<div className="absolute top-0 left-0 right-0 p-4 md:p-6">
					<div className="text-xs font-bold uppercase tracking-widest text-red-500 mb-1">
						&gt;&gt;&gt; NOW PLAYING &lt;&lt;&lt;
					</div>
					<h2 className="text-3xl sm:text-5xl md:text-7xl font-black uppercase leading-none tracking-tighter drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
						{song.title}
					</h2>
					<div className="mt-2 flex items-center gap-3 flex-wrap">
						<span className="text-lg sm:text-xl font-bold uppercase drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
							{song.artistName}
						</span>
						<span className="text-white/40">|</span>
						<span className="text-xs sm:text-sm uppercase text-white/70 bg-white/10 px-2 py-0.5 border border-white/20">
							{song.subGenre || song.genre}
						</span>
					</div>
					<div className="mt-2 flex gap-4 text-xs uppercase text-white/50">
						<span>{song.bpm} BPM</span>
						<span>{song.keyScale.toUpperCase()}</span>
					</div>
				</div>

				{/* Bottom controls overlay */}
				<div className="absolute bottom-0 left-0 right-0 p-4 md:p-6">
					{/* Progress bar */}
					<div className="mb-3">
						<div className="flex items-center justify-between text-xs font-bold uppercase mb-1 text-white/70">
							<span>{formatTime(currentTime)}</span>
							<span>{formatTime(duration)}</span>
						</div>
						<div
							className="border-2 border-white/30 bg-black/40 cursor-pointer backdrop-blur-sm"
							onClick={(e) => {
								const rect = e.currentTarget.getBoundingClientRect();
								const pct = (e.clientX - rect.left) / rect.width;
								onSeek(pct * duration);
							}}
						>
							<div
								className="h-3 bg-red-500 transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>

					{/* Control buttons */}
					<div className="flex items-center gap-2 flex-wrap">
						<Button
							variant="outline"
							onClick={onToggle}
							className="h-10 rounded-none border-2 border-white/30 bg-white/10 backdrop-blur-sm font-mono text-sm font-black uppercase text-white hover:bg-red-500 hover:text-white hover:border-red-500"
						>
							{isPlaying ? (
								<>
									<Pause className="mr-1 h-4 w-4" />
									PAUSE
								</>
							) : (
								<>
									<Play className="mr-1 h-4 w-4" />
									PLAY
								</>
							)}
						</Button>
						<Button
							variant="outline"
							onClick={onSkip}
							className="h-10 rounded-none border-2 border-white/30 bg-white/10 backdrop-blur-sm font-mono text-sm font-black uppercase text-white hover:bg-white hover:text-black"
						>
							<SkipForward className="mr-1 h-4 w-4" />
							SKIP
						</Button>
						<Button
							variant="outline"
							onClick={handleDownload}
							disabled={!song.audioUrl || isDownloading}
							className="h-10 rounded-none border-2 border-white/30 bg-white/10 backdrop-blur-sm font-mono text-sm font-black uppercase text-white hover:bg-white hover:text-black disabled:opacity-30"
						>
							<Download className="mr-1 h-4 w-4" />
							{isDownloading ? "DL..." : "DL"}
						</Button>

						{/* Volume — pushed to the right */}
						<div className="ml-auto flex items-center gap-2 bg-black/40 backdrop-blur-sm border-2 border-white/30 px-3 py-1">
							<button
								onClick={toggleMute}
								className="text-white/70 hover:text-white"
							>
								{isMuted ? (
									<VolumeX className="h-4 w-4" />
								) : (
									<Volume2 className="h-4 w-4" />
								)}
							</button>
							<div
								className="h-3 w-20 border border-white/30 bg-black/40 cursor-pointer"
								onClick={(e) => {
									const rect = e.currentTarget.getBoundingClientRect();
									const pct = Math.max(
										0,
										Math.min(1, (e.clientX - rect.left) / rect.width),
									);
									setVolume(pct);
								}}
							>
								<div
									className="h-full bg-white"
									style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
								/>
							</div>
							<span className="text-xs font-bold text-white/70">
								{Math.round((isMuted ? 0 : volume) * 100)}%
							</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
