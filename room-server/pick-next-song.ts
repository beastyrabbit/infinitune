import type { SongData } from "./protocol.js";

/**
 * Pick the candidate ahead of `idx` first, wrapping to the lowest orderIndex
 * only when nothing ahead exists.
 */
function pickAheadFirst(
	candidates: SongData[],
	idx: number | undefined,
): SongData | null {
	if (idx === undefined)
		return candidates.sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;
	const ahead = candidates
		.filter((s) => s.orderIndex > idx)
		.sort((a, b) => a.orderIndex - b.orderIndex);
	if (ahead.length > 0) return ahead[0];
	return candidates.sort((a, b) => a.orderIndex - b.orderIndex)[0] ?? null;
}

/**
 * Priority-based song selection (mirrors src/lib/pick-next-song.ts).
 *
 * P1: Interrupts (isInterrupt && ready) — oldest first
 * P2: Current-epoch songs — next by orderIndex after currentOrderIndex
 * P3: Any remaining ready/played song — fill silence
 */
export function pickNextSong(
	songs: SongData[],
	currentSongId: string | null,
	playlistEpoch: number,
	currentOrderIndex?: number,
	manualMode?: boolean,
): SongData | null {
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
		// P2: Current-epoch songs
		const currentEpochSongs = candidates.filter(
			(s) => (s.promptEpoch ?? 0) === playlistEpoch,
		);
		const p2 = pickAheadFirst(currentEpochSongs, currentOrderIndex);
		if (p2) return p2;
	}

	// P3: Any remaining ready song
	return pickAheadFirst(candidates, currentOrderIndex);
}
