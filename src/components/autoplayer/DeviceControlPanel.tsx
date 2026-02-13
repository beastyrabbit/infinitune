import {
	Download,
	FileText,
	Monitor,
	Pause,
	Pencil,
	Play,
	RefreshCw,
	SkipForward,
	ThumbsDown,
	ThumbsUp,
	Volume2,
	X,
} from "lucide-react";
import { useCallback, useState } from "react";
import type {
	Device,
	PlaybackState,
	SongData,
} from "../../../room-server/protocol";

function formatTime(seconds: number): string {
	if (!seconds || !Number.isFinite(seconds)) return "0:00";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function ProgressBar({
	currentTime,
	duration,
	className = "",
}: {
	currentTime: number;
	duration: number;
	className?: string;
}) {
	const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<span className="text-[10px] font-bold text-white/40 tabular-nums w-8 text-right flex-shrink-0">
				{formatTime(currentTime)}
			</span>
			<div className="flex-1 h-1 bg-white/10 overflow-hidden">
				<div
					className="h-full bg-red-500 transition-[width] duration-1000 ease-linear"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="text-[10px] font-bold text-white/40 tabular-nums w-8 flex-shrink-0">
				{formatTime(duration)}
			</span>
		</div>
	);
}

function RenameModal({
	device,
	onRename,
	onClose,
}: {
	device: Device;
	onRename: (deviceId: string, name: string) => void;
	onClose: () => void;
}) {
	const [value, setValue] = useState(device.name);
	const handleSubmit = () => {
		const trimmed = value.trim();
		if (trimmed) {
			onRename(device.id, trimmed);
		}
		onClose();
	};
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
			<div className="border-2 border-white/20 bg-gray-950 p-4 w-80">
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-xs font-black uppercase tracking-widest text-white/60">
						RENAME DEVICE
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="text-white/30 hover:text-white"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
				<input
					type="text"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					className="w-full bg-white/5 border-2 border-white/15 px-3 py-2 text-sm font-mono font-bold uppercase placeholder:text-white/20 focus:outline-none focus:border-red-500 transition-colors mb-3"
					onKeyDown={(e) => {
						if (e.key === "Enter") handleSubmit();
						if (e.key === "Escape") onClose();
					}}
				/>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={handleSubmit}
						className="flex-1 h-8 border-2 border-red-500 bg-red-500/10 text-xs font-bold uppercase text-red-400 hover:bg-red-500 hover:text-white transition-colors"
					>
						SAVE
					</button>
					<button
						type="button"
						onClick={onClose}
						className="flex-1 h-8 border-2 border-white/20 bg-white/5 text-xs font-bold uppercase text-white/50 hover:bg-white hover:text-black transition-colors"
					>
						CANCEL
					</button>
				</div>
			</div>
		</div>
	);
}

interface DeviceControlPanelProps {
	devices: Device[];
	playback: PlaybackState;
	currentSong: SongData | null;
	onToggle: () => void;
	onSkip: () => void;
	onRate?: (rating: "up" | "down") => void;
	onSetVolume?: (volume: number) => void;
	onSetDeviceVolume?: (deviceId: string, volume: number) => void;
	onToggleDevicePlay?: (deviceId: string) => void;
	onSyncAll?: () => void;
	onRenameDevice?: (deviceId: string, name: string) => void;
}

export function DeviceControlPanel({
	devices,
	playback,
	currentSong,
	onToggle,
	onSkip,
	onRate,
	onSetVolume,
	onSetDeviceVolume,
	onToggleDevicePlay,
	onSyncAll,
	onRenameDevice,
}: DeviceControlPanelProps) {
	const playerDevices = devices.filter((d) => d.role === "player");
	const [renamingDevice, setRenamingDevice] = useState<Device | null>(null);
	const [showLyrics, setShowLyrics] = useState(false);

	const handleRename = useCallback(
		(deviceId: string, name: string) => {
			onRenameDevice?.(deviceId, name);
		},
		[onRenameDevice],
	);

	return (
		<div className="flex flex-col h-full bg-black/50">
			{/* Top: song info + master controls */}
			<div className="flex-shrink-0 px-6 py-4">
				{/* Current song info */}
				{currentSong ? (
					<div className="mb-4">
						<h2 className="text-xl font-black uppercase tracking-tight truncate">
							{currentSong.title ?? "UNKNOWN"}
						</h2>
						<p className="text-sm font-bold uppercase text-white/50 truncate">
							{currentSong.artistName ?? "UNKNOWN ARTIST"}
						</p>
						{currentSong.genre && (
							<p className="text-[10px] font-bold uppercase text-white/30 mt-0.5">
								{currentSong.genre}
								{currentSong.subGenre ? ` / ${currentSong.subGenre}` : ""}
							</p>
						)}
					</div>
				) : (
					<div className="mb-4">
						<h2 className="text-xl font-black uppercase tracking-tight text-white/30">
							NO SONG PLAYING
						</h2>
					</div>
				)}

				{/* Song action buttons (rating, lyrics, download) */}
				<div className="flex items-center gap-2 mb-4">
					{onRate && (
						<>
							<button
								type="button"
								onClick={() => onRate("up")}
								className={`h-8 w-8 flex items-center justify-center border-2 transition-colors ${
									currentSong?.userRating === "up"
										? "border-green-500 bg-green-500/20 text-green-400"
										: "border-white/20 bg-white/5 text-white/50 hover:border-green-500/50 hover:text-green-400"
								}`}
							>
								<ThumbsUp className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								onClick={() => onRate("down")}
								className={`h-8 w-8 flex items-center justify-center border-2 transition-colors ${
									currentSong?.userRating === "down"
										? "border-red-500 bg-red-500/20 text-red-400"
										: "border-white/20 bg-white/5 text-white/50 hover:border-red-500/50 hover:text-red-400"
								}`}
							>
								<ThumbsDown className="h-3.5 w-3.5" />
							</button>
						</>
					)}
					<button
						type="button"
						onClick={() => setShowLyrics(!showLyrics)}
						className={`h-8 w-8 flex items-center justify-center border-2 transition-colors ${
							showLyrics
								? "border-cyan-500 bg-cyan-500/20 text-cyan-400"
								: "border-white/20 bg-white/5 text-white/50 hover:border-cyan-500/50 hover:text-cyan-400"
						}`}
					>
						<FileText className="h-3.5 w-3.5" />
					</button>
					{currentSong?.audioUrl && (
						<a
							href={currentSong.audioUrl}
							download={`${currentSong.title ?? "song"}.mp3`}
							className="h-8 w-8 flex items-center justify-center border-2 border-white/20 bg-white/5 text-white/50 hover:border-yellow-500/50 hover:text-yellow-400 transition-colors"
						>
							<Download className="h-3.5 w-3.5" />
						</a>
					)}
				</div>

				{/* Lyrics panel */}
				{showLyrics && currentSong?.lyrics && (
					<div className="border-2 border-cyan-500/20 bg-cyan-500/5 px-3 py-2 mb-4 max-h-40 overflow-y-auto">
						<pre className="text-[10px] font-mono text-white/60 whitespace-pre-wrap">
							{currentSong.lyrics}
						</pre>
					</div>
				)}

				{/* All-devices control bar */}
				<div className="border-2 border-red-500/30 bg-red-500/5 px-4 py-3">
					<div className="flex items-center justify-between">
						<span className="text-xs font-black uppercase text-red-400 flex-shrink-0">
							ALL PLAYERS
						</span>
						<div className="flex items-center gap-2 flex-shrink-0">
							{onSyncAll && (
								<button
									type="button"
									onClick={onSyncAll}
									title="SYNC ALL — reset all players to room defaults"
									className="h-8 w-8 flex items-center justify-center border-2 border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500 hover:text-black transition-colors"
								>
									<RefreshCw className="h-3.5 w-3.5" />
								</button>
							)}
							<button
								type="button"
								onClick={onToggle}
								className="h-8 w-8 flex items-center justify-center border-2 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
							>
								{playback.isPlaying ? (
									<Pause className="h-3.5 w-3.5" />
								) : (
									<Play className="h-3.5 w-3.5" />
								)}
							</button>
							<button
								type="button"
								onClick={onSkip}
								className="h-8 w-8 flex items-center justify-center border-2 border-white/20 bg-white/5 text-white/60 hover:bg-white hover:text-black transition-colors"
							>
								<SkipForward className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					{onSetVolume && (
						<div className="flex items-center gap-2 mt-2">
							<Volume2 className="h-3 w-3 text-red-400 flex-shrink-0" />
							<input
								type="range"
								min={0}
								max={1}
								step={0.01}
								value={playback.volume}
								onChange={(e) => onSetVolume(Number.parseFloat(e.target.value))}
								className="flex-1 h-1 accent-red-500 cursor-pointer"
							/>
							<span className="text-[10px] font-bold text-white/40 tabular-nums w-8 text-right flex-shrink-0">
								{Math.round(playback.volume * 100)}%
							</span>
						</div>
					)}
					<ProgressBar
						currentTime={playback.currentTime}
						duration={playback.duration}
						className="mt-2"
					/>
				</div>
			</div>

			{/* Bottom: scrollable player device list */}
			<div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
				<div className="flex items-center justify-between mb-2">
					<h3 className="text-xs font-black uppercase tracking-widest text-white/40">
						PLAYERS
					</h3>
					<span className="text-xs font-bold uppercase text-white/30">
						{playerDevices.length} CONNECTED
					</span>
				</div>
				<div className="space-y-2">
					{playerDevices.map((device) => (
						<div
							key={device.id}
							className="border-2 border-white/10 bg-white/5 px-3 py-2"
						>
							<div className="flex items-center gap-3">
								<div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
								<Volume2 className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
								<div className="min-w-0 flex-1">
									<div className="text-xs font-bold uppercase text-white/80 truncate">
										{device.name}
									</div>
								</div>
								<div className="flex items-center gap-1 flex-shrink-0">
									{onRenameDevice && (
										<button
											type="button"
											onClick={() => setRenamingDevice(device)}
											className="h-6 w-6 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"
											title="Rename device"
										>
											<Pencil className="h-2.5 w-2.5" />
										</button>
									)}
									{onToggleDevicePlay && (
										<button
											type="button"
											onClick={() => onToggleDevicePlay(device.id)}
											className="h-6 w-6 flex items-center justify-center border border-white/15 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
											title="Toggle play/pause for this device"
										>
											{playback.isPlaying ? (
												<Pause className="h-2.5 w-2.5" />
											) : (
												<Play className="h-2.5 w-2.5" />
											)}
										</button>
									)}
								</div>
							</div>
							<ProgressBar
								currentTime={playback.currentTime}
								duration={playback.duration}
								className="mt-1.5"
							/>
							{onSetDeviceVolume && (
								<div className="flex items-center gap-2 mt-1.5">
									<Volume2 className="h-2.5 w-2.5 text-white/30 flex-shrink-0" />
									<input
										type="range"
										min={0}
										max={1}
										step={0.01}
										defaultValue={playback.volume}
										onChange={(e) =>
											onSetDeviceVolume(
												device.id,
												Number.parseFloat(e.target.value),
											)
										}
										className="flex-1 h-1 accent-red-500 cursor-pointer"
									/>
								</div>
							)}
						</div>
					))}
					{playerDevices.length === 0 && (
						<div className="border-2 border-dashed border-white/10 px-3 py-4 text-center">
							<Monitor className="h-4 w-4 text-white/15 mx-auto mb-1" />
							<p className="text-[10px] font-bold uppercase text-white/25">
								NO PLAYERS CONNECTED
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Rename modal */}
			{renamingDevice && (
				<RenameModal
					device={renamingDevice}
					onRename={handleRename}
					onClose={() => setRenamingDevice(null)}
				/>
			)}
		</div>
	);
}
