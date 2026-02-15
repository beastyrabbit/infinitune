import type { PlaylistStatus, SongStatus } from "../types";

/**
 * Allowed song status transitions. Key = current status, value = valid next statuses.
 */
export const ALLOWED_SONG_TRANSITIONS: Record<SongStatus, SongStatus[]> = {
	pending: ["generating_metadata", "error"],
	generating_metadata: ["metadata_ready", "error", "retry_pending", "pending"],
	metadata_ready: ["submitting_to_ace", "error", "retry_pending"],
	submitting_to_ace: [
		"generating_audio",
		"error",
		"retry_pending",
		"metadata_ready",
	],
	generating_audio: ["saving", "error", "retry_pending", "metadata_ready"],
	saving: ["ready", "error", "generating_audio", "metadata_ready"],
	ready: ["played"],
	played: ["ready"], // allow replay
	error: ["pending", "metadata_ready", "retry_pending"],
	retry_pending: ["pending", "metadata_ready", "error"],
};

/** Validate a song status transition. */
export function validateSongTransition(
	from: SongStatus,
	to: SongStatus,
): boolean {
	const allowed = ALLOWED_SONG_TRANSITIONS[from];
	return allowed ? allowed.includes(to) : false;
}

/**
 * Allowed playlist status transitions.
 */
export const ALLOWED_PLAYLIST_TRANSITIONS: Record<
	PlaylistStatus,
	PlaylistStatus[]
> = {
	active: ["closing", "closed"],
	closing: ["active", "closed"],
	closed: [], // terminal state
};

/** Validate a playlist status transition. */
export function validatePlaylistTransition(
	from: PlaylistStatus,
	to: PlaylistStatus,
): boolean {
	const allowed = ALLOWED_PLAYLIST_TRANSITIONS[from];
	return allowed ? allowed.includes(to) : false;
}
