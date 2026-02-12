import type { SongStatus } from "../../convex/types";

/** Descriptive labels for the track detail panel */
export const STATUS_LABELS: Record<string, string> = {
	pending: "QUEUED — WAITING FOR WORKER",
	generating_metadata: "WRITING LYRICS & METADATA",
	metadata_ready: "METADATA READY — QUEUED FOR AUDIO",
	submitting_to_ace: "COVER ART + SUBMITTING TO ENGINE",
	generating_audio: "AUDIO SYNTHESIS IN PROGRESS",
	saving: "SAVING TO LIBRARY",
	ready: "READY TO PLAY",
	played: "PLAYED",
	retry_pending: "RETRY PENDING",
	error: "ERROR",
};

/** Simplified progress text for the oneshot generating display */
export const STATUS_PROGRESS_TEXT: Record<string, string> = {
	pending: "WRITING LYRICS...",
	generating_metadata: "WRITING LYRICS...",
	metadata_ready: "PREPARING AUDIO...",
	submitting_to_ace: "PREPARING AUDIO...",
	generating_audio: "GENERATING AUDIO...",
	saving: "GENERATING AUDIO...",
};

/** Status badge (text + className) for the queue grid song cards */
export function getStatusBadge(
	status: SongStatus,
	isCurrent: boolean,
): { text: string; className: string } {
	if (isCurrent)
		return { text: "[PLAYING]", className: "text-red-500 font-black" };
	switch (status) {
		case "ready":
			return { text: "[READY]", className: "text-white font-bold" };
		case "pending":
			return {
				text: "[QUEUED]",
				className: "text-blue-400 animate-pulse font-bold",
			};
		case "generating_metadata":
			return {
				text: "[WRITING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "metadata_ready":
			return { text: "[METADATA OK]", className: "text-cyan-400 font-bold" };
		case "submitting_to_ace":
			return {
				text: "[SUBMITTING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "generating_audio":
			return {
				text: "[GENERATING AUDIO...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "saving":
			return {
				text: "[SAVING...]",
				className: "text-yellow-500 animate-pulse font-bold",
			};
		case "played":
			return { text: "[READY]", className: "text-white/50 font-bold" };
		case "retry_pending":
			return {
				text: "[RETRY PENDING]",
				className: "text-orange-400 font-bold",
			};
		case "error":
			return { text: "[ERROR]", className: "text-red-400 font-bold" };
	}
}
