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

/**
 * A flat bar with a transparent native range input on top, so pointer,
 * touch and keyboard users get a real slider without changing the look.
 */
function RangeBar({
	label,
	value,
	max,
	step,
	valueText,
	disabled,
	onChange,
	className,
	fillClassName,
}: Readonly<{
	label: string;
	value: number;
	max: number;
	step: number;
	valueText: string;
	disabled?: boolean;
	onChange: (value: number) => void;
	className: string;
	fillClassName: string;
}>) {
	const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;

	return (
		<div
			className={`relative has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white ${className}`}
		>
			<div className={fillClassName} style={{ width: `${percent}%` }} />
			<input
				type="range"
				aria-label={label}
				aria-valuetext={valueText}
				min={0}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
				// A 1px thumb makes a click land exactly where the bar was hit.
				className="absolute left-0 -top-2 m-0 h-[calc(100%+1rem)] w-full cursor-pointer appearance-none opacity-0 disabled:cursor-default [&::-moz-range-thumb]:size-px [&::-moz-range-thumb]:border-0 [&::-webkit-slider-thumb]:size-px [&::-webkit-slider-thumb]:appearance-none"
			/>
		</div>
	);
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
}: Readonly<{
	isCurrentSong: boolean | null;
	isPlaying: boolean;
	currentTime: number;
	audioDuration: number;
	onPlayPause: () => void;
	onSeek: (time: number) => void;
	playButtonClassName: string;
	progressBarClassName: string;
}>) {
	const canSeek = Boolean(isCurrentSong) && audioDuration > 0;
	const position = canSeek ? currentTime : 0;

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
				<RangeBar
					label="Seek"
					value={position}
					max={canSeek ? audioDuration : 0}
					step={1}
					valueText={`${formatTime(position)} of ${canSeek ? formatTime(audioDuration) : "--:--"}`}
					disabled={!canSeek}
					onChange={onSeek}
					className="flex-1 h-2 border-2 border-white/20 bg-black"
					fillClassName={progressBarClassName}
				/>
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
}: Readonly<{
	volume: number;
	isMuted: boolean;
}>) {
	const level = isMuted ? 0 : volume;

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
			<RangeBar
				label="Volume"
				value={level}
				max={1}
				step={0.05}
				valueText={`${Math.round(level * 100)}%`}
				onChange={setVolume}
				className="h-1.5 w-16 border border-white/20 bg-black"
				fillClassName="h-full bg-white"
			/>
		</div>
	);
}
