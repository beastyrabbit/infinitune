import type { SongStatus } from "./types";

/** Format seconds as "M:SS" for audio player displays */
export function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Format milliseconds as human-readable elapsed time: "42s", "3m 12s" */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const m = Math.floor(totalSeconds / 60);
	const s = totalSeconds % 60;
	return `${m}m ${s}s`;
}

/** Format a timestamp as relative time ago: "5s ago", "3min ago", "2h ago" */
export function formatTimeAgo(ms: number): string {
	const seconds = Math.floor((Date.now() - ms) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}min ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

/** Format milliseconds with sub-second precision: "500ms", "42s", "3m 12s" */
export function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

/** Statuses that represent an active generation pipeline */
const GENERATING_STATUSES: SongStatus[] = [
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"generating_audio",
	"saving",
];

/** Check if a song status represents any stage of the generation pipeline */
export function isGenerating(status: SongStatus): boolean {
	return GENERATING_STATUSES.includes(status);
}

/** Check if a song status means the track is playable */
export function isPlayable(status: SongStatus): boolean {
	return status === "ready" || status === "played";
}
