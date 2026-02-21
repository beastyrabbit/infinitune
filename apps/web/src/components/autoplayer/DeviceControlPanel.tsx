import type {
	Device,
	PlaybackState,
	SongData,
} from "@infinitune/shared/protocol";
import {
	Download,
	FileText,
	Monitor,
	Pause,
	Pencil,
	Play,
	RefreshCw,
	RotateCcw,
	SkipForward,
	ThumbsDown,
	ThumbsUp,
	Volume2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
	onSeek,
}: {
	currentTime: number;
	duration: number;
	className?: string;
	onSeek?: (time: number) => void;
}) {
	const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

	// Detect large jumps (seek / resume mis-sync) and disable CSS transition
	// so the bar snaps instantly instead of slowly sliding.
	const prevPctRef = useRef(pct);
	const isJump = Math.abs(pct - prevPctRef.current) > 3;
	prevPctRef.current = pct;

	const handleClick = onSeek
		? (e: React.MouseEvent<HTMLDivElement>) => {
				const rect = e.currentTarget.getBoundingClientRect();
				const ratio = Math.max(
					0,
					Math.min(1, (e.clientX - rect.left) / rect.width),
				);
				onSeek(ratio * duration);
			}
		: undefined;
	const handleKeyDown = onSeek
		? (e: React.KeyboardEvent<HTMLDivElement>) => {
				const step = Math.max(duration / 20, 1);
				if (e.key === "ArrowRight") {
					e.preventDefault();
					onSeek(Math.min(duration, currentTime + step));
				} else if (e.key === "ArrowLeft") {
					e.preventDefault();
					onSeek(Math.max(0, currentTime - step));
				} else if (e.key === "Home") {
					e.preventDefault();
					onSeek(0);
				} else if (e.key === "End") {
					e.preventDefault();
					onSeek(duration);
				}
			}
		: undefined;
	const trackClassName = `flex-1 h-1 bg-white/10 overflow-hidden ${onSeek ? "cursor-pointer hover:h-1.5 transition-[height]" : ""}`;
	const fill = (
		<div
			className={`h-full bg-red-500 ${isJump ? "" : "transition-[width] duration-1000 ease-linear"}`}
			style={{ width: `${pct}%` }}
		/>
	);
	return (
		<div className={`flex items-center gap-2 ${className}`}>
			<span className="text-[10px] font-bold text-white/40 tabular-nums w-8 text-right flex-shrink-0">
				{formatTime(currentTime)}
			</span>
			{onSeek ? (
				<div
					className={trackClassName}
					role="slider"
					tabIndex={0}
					aria-label="Seek position"
					aria-valuemin={0}
					aria-valuemax={Math.max(duration, 0)}
					aria-valuenow={Math.max(currentTime, 0)}
					onClick={handleClick}
					onKeyDown={handleKeyDown}
				>
					{fill}
				</div>
			) : (
				<div className={trackClassName}>{fill}</div>
			)}
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

/**
 * Per-device card with local state for volume and play/pause.
 * Extracted so each device can have its own useState hooks.
 */
function DeviceCard({
	device,
	playback,
	onSetDeviceVolume,
	onToggleDevicePlay,
	onResetDeviceToDefault,
	onStartRename,
}: {
	device: Device;
	playback: PlaybackState;
	onSetDeviceVolume?: (deviceId: string, volume: number) => void;
	onToggleDevicePlay?: (deviceId: string) => void;
	onResetDeviceToDefault?: (deviceId: string) => void;
	onStartRename?: () => void;
}) {
	const isIndividual = device.mode === "individual";
	const [localVolume, setLocalVolume] = useState(playback.volume);
	const [localPlaying, setLocalPlaying] = useState(playback.isPlaying);
	const volumeDragging = useRef(false);
	const volumeSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Default-mode devices: sync volume from room state when not dragging
	useEffect(() => {
		if (!isIndividual && !volumeDragging.current) {
			setLocalVolume(playback.volume);
		}
	}, [playback.volume, isIndividual]);

	// Default-mode devices: sync play state from room
	useEffect(() => {
		if (!isIndividual) {
			setLocalPlaying(playback.isPlaying);
		}
	}, [playback.isPlaying, isIndividual]);

	// When mode resets to default (e.g. DEFAULT button or SYNC ALL), snap to room state
	const prevModeRef = useRef(device.mode);
	useEffect(() => {
		if (prevModeRef.current === "individual" && !isIndividual) {
			setLocalVolume(playback.volume);
			setLocalPlaying(playback.isPlaying);
		}
		prevModeRef.current = device.mode;
	}, [isIndividual, playback.volume, playback.isPlaying, device.mode]);

	useEffect(() => {
		return () => {
			if (volumeSendTimer.current) {
				clearTimeout(volumeSendTimer.current);
				volumeSendTimer.current = null;
			}
		};
	}, []);

	return (
		<div
			className={`border-2 px-3 py-2 ${
				isIndividual
					? "border-yellow-500/40 bg-yellow-500/5"
					: "border-white/10 bg-white/5"
			}`}
		>
			<div className="flex items-center gap-3">
				<div
					className={`h-2 w-2 rounded-full flex-shrink-0 ${
						isIndividual ? "bg-yellow-500" : "bg-green-500"
					}`}
				/>
				<Volume2 className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="text-xs font-bold uppercase text-white/80 truncate">
							{device.name}
						</span>
						{isIndividual && (
							<span className="text-[9px] font-black uppercase text-yellow-400 flex-shrink-0">
								INDIVIDUAL
							</span>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1 flex-shrink-0">
					{isIndividual && onResetDeviceToDefault && (
						<button
							type="button"
							onClick={() => onResetDeviceToDefault(device.id)}
							className="h-6 px-1.5 flex items-center justify-center gap-0.5 border border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500 hover:text-black transition-colors"
							title="Reset to default — follow room settings"
						>
							<RotateCcw className="h-2.5 w-2.5" />
							<span className="text-[9px] font-black uppercase">DEFAULT</span>
						</button>
					)}
					{onStartRename && (
						<button
							type="button"
							onClick={onStartRename}
							className="h-6 w-6 flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"
							title="Rename device"
						>
							<Pencil className="h-2.5 w-2.5" />
						</button>
					)}
					{onToggleDevicePlay && (
						<button
							type="button"
							onClick={() => {
								onToggleDevicePlay(device.id);
								setLocalPlaying(!localPlaying);
							}}
							className="h-6 w-6 flex items-center justify-center border border-white/15 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
							title="Toggle play/pause for this device"
						>
							{localPlaying ? (
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
						value={localVolume}
						onPointerDown={() => {
							volumeDragging.current = true;
						}}
						onPointerUp={(e) => {
							const v = Number.parseFloat((e.target as HTMLInputElement).value);
							if (Number.isFinite(v)) {
								if (volumeSendTimer.current) {
									clearTimeout(volumeSendTimer.current);
									volumeSendTimer.current = null;
								}
								onSetDeviceVolume(device.id, v);
							}
							setTimeout(() => {
								volumeDragging.current = false;
							}, 300);
						}}
						onChange={(e) => {
							const v = Number.parseFloat(e.target.value);
							setLocalVolume(v);
							if (volumeSendTimer.current) {
								clearTimeout(volumeSendTimer.current);
							}
							volumeSendTimer.current = setTimeout(() => {
								onSetDeviceVolume(device.id, v);
								volumeSendTimer.current = null;
							}, 150);
						}}
						className="flex-1 h-1 accent-red-500 cursor-pointer"
					/>
				</div>
			)}
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
	onResetDeviceToDefault?: (deviceId: string) => void;
	onSeek?: (time: number) => void;
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
	onResetDeviceToDefault,
	onSeek,
}: DeviceControlPanelProps) {
	const playerDevices = devices.filter((d) => d.role === "player");
	const [renamingDevice, setRenamingDevice] = useState<Device | null>(null);
	const [showLyrics, setShowLyrics] = useState(false);

	// Local volume state for ALL PLAYERS slider — immediate feedback, server sync when idle
	const [roomVolume, setRoomVolume] = useState(playback.volume);
	const roomVolumeDragging = useRef(false);
	const roomVolumeSendTimer = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	useEffect(() => {
		if (!roomVolumeDragging.current) {
			setRoomVolume(playback.volume);
		}
	}, [playback.volume]);
	useEffect(() => {
		return () => {
			if (roomVolumeSendTimer.current) {
				clearTimeout(roomVolumeSendTimer.current);
				roomVolumeSendTimer.current = null;
			}
		};
	}, []);

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
								value={roomVolume}
								onPointerDown={() => {
									roomVolumeDragging.current = true;
								}}
								onPointerUp={(e) => {
									const v = Number.parseFloat(
										(e.target as HTMLInputElement).value,
									);
									if (Number.isFinite(v)) {
										if (roomVolumeSendTimer.current) {
											clearTimeout(roomVolumeSendTimer.current);
											roomVolumeSendTimer.current = null;
										}
										onSetVolume(v);
									}
									setTimeout(() => {
										roomVolumeDragging.current = false;
									}, 300);
								}}
								onChange={(e) => {
									const v = Number.parseFloat(e.target.value);
									setRoomVolume(v);
									if (roomVolumeSendTimer.current) {
										clearTimeout(roomVolumeSendTimer.current);
									}
									roomVolumeSendTimer.current = setTimeout(() => {
										onSetVolume(v);
										roomVolumeSendTimer.current = null;
									}, 150);
								}}
								className="flex-1 h-1 accent-red-500 cursor-pointer"
							/>
							<span className="text-[10px] font-bold text-white/40 tabular-nums w-8 text-right flex-shrink-0">
								{Math.round(roomVolume * 100)}%
							</span>
						</div>
					)}
					<ProgressBar
						currentTime={playback.currentTime}
						duration={playback.duration}
						className="mt-2"
						onSeek={onSeek}
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
						<DeviceCard
							key={device.id}
							device={device}
							playback={playback}
							onSetDeviceVolume={onSetDeviceVolume}
							onToggleDevicePlay={onToggleDevicePlay}
							onResetDeviceToDefault={onResetDeviceToDefault}
							onStartRename={
								onRenameDevice ? () => setRenamingDevice(device) : undefined
							}
						/>
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
			{renamingDevice && onRenameDevice && (
				<RenameModal
					device={renamingDevice}
					onRename={onRenameDevice}
					onClose={() => setRenamingDevice(null)}
				/>
			)}
		</div>
	);
}
