import { useStore } from "@tanstack/react-store";
import { Download, Pause, Play, SkipForward, ThumbsDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import FileDescriptionIcon from "@/components/ui/file-description-icon";
import LikeIcon from "@/components/ui/like-icon";
import Volume2Icon from "@/components/ui/volume-2-icon";
import VolumeXIcon from "@/components/ui/volume-x-icon";
import XIcon from "@/components/ui/x-icon";
import { playerStore, setVolume, toggleMute } from "@/lib/player-store";
import type { Song } from "@/types/convex";
import { CoverArt } from "./CoverArt";

interface NowPlayingProps {
	song: Song | null;
	onToggle: () => void;
	onSkip: () => void;
	onSeek: (time: number) => void;
	onRate: (rating: "up" | "down") => void;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Parse lyrics into structured sections */
function parseLyrics(raw: string) {
	const lines = raw.split("\n");
	const sections: { heading?: string; lines: string[] }[] = [];
	let current: { heading?: string; lines: string[] } = { lines: [] };

	for (const line of lines) {
		const trimmed = line.trim();
		if (/^\[.+\]$/.test(trimmed)) {
			// Start new section
			if (current.heading || current.lines.length > 0) {
				sections.push(current);
			}
			current = { heading: trimmed.slice(1, -1), lines: [] };
		} else if (trimmed) {
			current.lines.push(trimmed);
		}
	}
	if (current.heading || current.lines.length > 0) {
		sections.push(current);
	}
	return sections;
}

export function NowPlaying({
	song,
	onToggle,
	onSkip,
	onSeek,
	onRate,
}: NowPlayingProps) {
	const { isPlaying, currentTime, duration, volume, isMuted } =
		useStore(playerStore);
	const [isDownloading, setIsDownloading] = useState(false);
	const [showLyrics, setShowLyrics] = useState(false);
	const lyricsRef = useRef<HTMLDivElement>(null);

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

	const lyricsSections = song.lyrics ? parseLyrics(song.lyrics) : [];

	return (
		<div>
			{/* Overlay container — cover art as background, controls on top */}
			<div className="relative aspect-square overflow-hidden">
				{/* Cover art background */}
				<div className="absolute inset-0">
					<CoverArt
						title={song.title || "Unknown"}
						artistName={song.artistName || "Unknown"}
						coverUrl={song.coverUrl}
						size="lg"
						fill
						spinning={isPlaying}
					/>
				</div>

				{/* Gradient overlay for readability */}
				<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

				{/* Lyrics overlay */}
				{showLyrics && song.lyrics && (
					<div className="absolute inset-0 bg-black/85 backdrop-blur-sm z-10 flex flex-col">
						<div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
							<span className="text-xs font-black uppercase tracking-widest text-white/60">
								<FileDescriptionIcon size={12} className="inline mr-2" />
								LYRICS
							</span>
							<button
								type="button"
								onClick={() => setShowLyrics(false)}
								className="text-white/60 hover:text-white"
							>
								<XIcon size={16} />
							</button>
						</div>
						<div
							ref={lyricsRef}
							className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
						>
							{lyricsSections.map((section, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: lyrics sections don't have stable IDs
								<div key={i}>
									{section.heading && (
										<p className="text-xs font-black uppercase tracking-wider text-red-500/80 mb-1">
											[{section.heading}]
										</p>
									)}
									{section.lines.map((line, j) => (
										<p
											// biome-ignore lint/suspicious/noArrayIndexKey: lyrics lines don't have stable IDs
											key={j}
											className="text-sm font-bold text-white/80 leading-relaxed"
										>
											{line}
										</p>
									))}
								</div>
							))}
						</div>
					</div>
				)}

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
						<span>{(song.keyScale || "C major").toUpperCase()}</span>
					</div>
				</div>

				{/* Bottom controls overlay */}
				<div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 z-20">
					{/* Progress bar */}
					<div className="mb-3">
						<div className="flex items-center justify-between text-xs font-bold uppercase mb-1 text-white/70">
							<span>{formatTime(currentTime)}</span>
							<span>{formatTime(duration)}</span>
						</div>
						<div
							role="slider"
							tabIndex={0}
							aria-label="Seek"
							aria-valuenow={Math.round(progress)}
							aria-valuemin={0}
							aria-valuemax={100}
							className="border-2 border-white/30 bg-black/40 cursor-pointer backdrop-blur-sm"
							onClick={(e) => {
								const rect = e.currentTarget.getBoundingClientRect();
								const pct = (e.clientX - rect.left) / rect.width;
								onSeek(pct * duration);
							}}
							onKeyDown={(e) => {
								if (e.key === "ArrowRight") {
									e.preventDefault();
									onSeek(Math.min(duration, currentTime + 5));
								} else if (e.key === "ArrowLeft") {
									e.preventDefault();
									onSeek(Math.max(0, currentTime - 5));
								}
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

						{/* Lyrics toggle */}
						{song.lyrics && (
							<Button
								variant="outline"
								onClick={() => setShowLyrics(!showLyrics)}
								className={`h-10 rounded-none border-2 backdrop-blur-sm font-mono text-sm font-black uppercase ${
									showLyrics
										? "border-yellow-500 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
										: "border-white/30 bg-white/10 text-white hover:bg-white hover:text-black"
								}`}
							>
								<FileDescriptionIcon size={16} className="mr-1" />
								LYR
							</Button>
						)}

						{/* Rating buttons */}
						<Button
							variant="outline"
							onClick={() => onRate("up")}
							className={`h-10 rounded-none border-2 backdrop-blur-sm font-mono text-sm font-black uppercase ${
								song.userRating === "up"
									? "border-green-500 bg-green-500/20 text-green-400 hover:bg-green-500/30 hover:text-green-300"
									: "border-white/30 bg-white/10 text-white hover:bg-green-500/20 hover:text-green-400 hover:border-green-500"
							}`}
						>
							<LikeIcon size={16} />
						</Button>
						<Button
							variant="outline"
							onClick={() => onRate("down")}
							className={`h-10 rounded-none border-2 backdrop-blur-sm font-mono text-sm font-black uppercase ${
								song.userRating === "down"
									? "border-red-500 bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300"
									: "border-white/30 bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400 hover:border-red-500"
							}`}
						>
							<ThumbsDown className="h-4 w-4" />
						</Button>

						{/* Volume — pushed to the right */}
						<div className="ml-auto flex items-center gap-2 bg-black/40 backdrop-blur-sm border-2 border-white/30 px-3 py-1">
							<button
								type="button"
								onClick={toggleMute}
								className="text-white/70 hover:text-white"
							>
								{isMuted ? (
									<VolumeXIcon size={16} />
								) : (
									<Volume2Icon size={16} />
								)}
							</button>
							<div
								role="slider"
								tabIndex={0}
								aria-label="Volume"
								aria-valuenow={Math.round((isMuted ? 0 : volume) * 100)}
								aria-valuemin={0}
								aria-valuemax={100}
								className="h-3 w-20 border border-white/30 bg-black/40 cursor-pointer"
								onClick={(e) => {
									const rect = e.currentTarget.getBoundingClientRect();
									const pct = Math.max(
										0,
										Math.min(1, (e.clientX - rect.left) / rect.width),
									);
									setVolume(pct);
								}}
								onKeyDown={(e) => {
									if (e.key === "ArrowRight") {
										e.preventDefault();
										setVolume(Math.min(1, volume + 0.05));
									} else if (e.key === "ArrowLeft") {
										e.preventDefault();
										setVolume(Math.max(0, volume - 0.05));
									}
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
