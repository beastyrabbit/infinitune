import { useMutation } from "convex/react";
import { useEffect } from "react";
import type { Id, Session, Song } from "@/types/convex";
import { api } from "../../convex/_generated/api";

/**
 * Manages session lifecycle side-effects:
 * - Updates the session's current playback position (for buffer calculation).
 * - Auto-closes sessions when all transient songs have finished.
 */
export function useSessionLifecycle(
	sessionId: Id<"sessions"> | null,
	session: Session | null | undefined,
	songs: Song[] | undefined,
	currentSongId: string | null,
) {
	const updateCurrentPosition = useMutation(api.sessions.updateCurrentPosition);
	const updateSessionStatus = useMutation(api.sessions.updateStatus);

	// Update session's current position when song changes
	useEffect(() => {
		if (!currentSongId || !songs || !sessionId) return;
		const song = songs.find((s) => s._id === currentSongId);
		if (song) {
			updateCurrentPosition({
				id: sessionId,
				currentOrderIndex: song.orderIndex,
			});
		}
	}, [currentSongId, songs, sessionId, updateCurrentPosition]);

	// Auto-close: when session is 'closing' and no songs are in transient state
	useEffect(() => {
		if (!session || session.status !== "closing" || !songs || !sessionId)
			return;

		const transientStatuses = [
			"pending",
			"generating_metadata",
			"metadata_ready",
			"submitting_to_ace",
			"generating_audio",
			"saving",
		];
		const stillActive = songs.some((s) => transientStatuses.includes(s.status));

		if (!stillActive) {
			updateSessionStatus({ id: sessionId, status: "closed" });
		}
	}, [session, songs, sessionId, updateSessionStatus]);
}
