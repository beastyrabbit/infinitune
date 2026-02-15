/**
 * Minimal interface for song queue selection.
 * Both the full `Song` wire type and the room `SongData` satisfy this.
 */
export interface PickableSong {
	_id: string;
	_creationTime: number;
	orderIndex: number;
	status: string;
	isInterrupt?: boolean | null;
	promptEpoch?: number | null;
}

/**
 * Pick the candidate ahead of `idx` first, wrapping to the lowest orderIndex
 * only when nothing ahead exists.
 */
function pickAheadFirst<T extends PickableSong>(
	candidates: T[],
	idx: number | undefined,
): T | null {
	if (idx === undefined)
		return candidates.sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;
	const ahead = candidates
		.filter((s) => s.orderIndex > idx)
		.sort((a, b) => a.orderIndex - b.orderIndex);
	if (ahead.length > 0) return ahead[0];
	return candidates.sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;
}

/**
 * Priority-based song selection for the autoplayer queue.
 *
 * Priority order:
 *   P1: Interrupts (isInterrupt && ready) — oldest _creationTime first (FIFO)
 *   P2: Current-epoch songs — next by orderIndex after currentOrderIndex
 *   P3: Any remaining ready/played song — next by orderIndex (fill silence)
 *
 * When `manualMode` is true (user manually selected a song), epoch priority
 * is skipped and already-played songs are included as candidates so skip
 * navigates sequentially through the full queue.
 */
export function pickNextSong<T extends PickableSong>(
	songs: T[],
	currentSongId: string | null,
	playlistEpoch: number,
	currentOrderIndex?: number,
	manualMode?: boolean,
): T | null {
	const PLAYABLE = manualMode ? ["ready", "played"] : ["ready"];
	const candidates = songs.filter(
		(s) => PLAYABLE.includes(s.status) && s._id !== currentSongId,
	);

	if (candidates.length === 0) return null;

	// P1: Interrupts — oldest first
	const interrupts = candidates
		.filter((s) => s.isInterrupt)
		.sort((a, b) => a._creationTime - b._creationTime);
	if (interrupts.length > 0) return interrupts[0];

	if (!manualMode) {
		// P2: Current-epoch songs — prefer ahead of current position
		const currentEpochSongs = candidates.filter(
			(s) => (s.promptEpoch ?? 0) === playlistEpoch,
		);
		const p2 = pickAheadFirst(currentEpochSongs, currentOrderIndex);
		if (p2) return p2;
	}

	// P3: Any remaining ready song — prefer ahead of current position (fill silence)
	return pickAheadFirst(candidates, currentOrderIndex);
}

/**
 * Find the next generating interrupt (for UP NEXT banner).
 * Returns the earliest interrupt that is still being generated.
 */
export function findGeneratingInterrupt<T extends PickableSong>(
	songs: T[],
): T | null {
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
			.filter((s) => s.isInterrupt && GENERATING_STATUSES.includes(s.status))
			.sort((a, b) => a._creationTime - b._creationTime)[0] ?? null
	);
}
