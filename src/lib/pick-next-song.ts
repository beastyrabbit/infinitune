import type { Song } from "@/types/convex";

/**
 * Priority-based song selection for the autoplayer queue.
 *
 * Priority order:
 *   P1: Interrupts (isInterrupt && ready) — oldest _creationTime first (FIFO)
 *   P2: Current-epoch songs — lowest orderIndex first
 *   P3: Any remaining ready song — lowest orderIndex first (fill silence)
 */
export function pickNextSong(
	songs: Song[],
	currentSongId: string | null,
	playlistEpoch: number,
): Song | null {
	const candidates = songs.filter(
		(s) =>
			s.status === "ready" &&
			s._id !== currentSongId,
	);

	if (candidates.length === 0) return null;

	// P1: Interrupts — oldest first
	const interrupts = candidates
		.filter((s) => s.isInterrupt)
		.sort((a, b) => a._creationTime - b._creationTime);
	if (interrupts.length > 0) return interrupts[0];

	// P2: Current-epoch songs — lowest orderIndex first
	const currentEpochSongs = candidates
		.filter((s) => (s.promptEpoch ?? 0) === playlistEpoch)
		.sort((a, b) => a.orderIndex - b.orderIndex);
	if (currentEpochSongs.length > 0) return currentEpochSongs[0];

	// P3: Any remaining ready song — lowest orderIndex first (fill silence)
	return candidates.sort((a, b) => a.orderIndex - b.orderIndex)[0];
}

/**
 * Find the next generating interrupt (for UP NEXT banner).
 * Returns the earliest interrupt that is still being generated.
 */
export function findGeneratingInterrupt(
	songs: Song[],
): Song | null {
	const GENERATING_STATUSES = [
		"pending",
		"generating_metadata",
		"metadata_ready",
		"submitting_to_ace",
		"generating_audio",
		"saving",
	];
	return (
		songs
			.filter(
				(s) =>
					s.isInterrupt &&
					GENERATING_STATUSES.includes(s.status),
			)
			.sort((a, b) => a._creationTime - b._creationTime)[0] ?? null
	);
}
