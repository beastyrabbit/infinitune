import { useEffect, useRef } from "react";
import { useAddListen, useAddPlayDuration } from "@/integrations/api/hooks";

/**
 * Tracks play duration and listen counts for songs.
 * - Flushes accumulated play time on song change, play/pause toggle, and unmount.
 * - Records a "listen" after 60 seconds of playback (once per song).
 */
export function usePlaybackTracking(
	currentSongId: string | null,
	isPlaying: boolean,
	currentTime: number,
) {
	const addPlayDurationMut = useAddPlayDuration();
	const addListenMut = useAddListen();

	const playStartRef = useRef<{ songId: string; startedAt: number } | null>(
		null,
	);
	const listenRecordedRef = useRef<string | null>(null);

	// Flush previous play session on state change, start new one
	useEffect(() => {
		const prev = playStartRef.current;
		if (prev) {
			const elapsed = Date.now() - prev.startedAt;
			if (elapsed > 1000) {
				addPlayDurationMut({ id: prev.songId, durationMs: elapsed });
			}
			playStartRef.current = null;
		}

		if (isPlaying && currentSongId) {
			playStartRef.current = { songId: currentSongId, startedAt: Date.now() };
		}

		// Reset listen tracking when song changes
		if (currentSongId !== listenRecordedRef.current) {
			listenRecordedRef.current = null;
		}

		return () => {
			const cur = playStartRef.current;
			if (cur) {
				const elapsed = Date.now() - cur.startedAt;
				if (elapsed > 1000) {
					addPlayDurationMut({ id: cur.songId, durationMs: elapsed });
				}
				playStartRef.current = null;
			}
		};
	}, [isPlaying, currentSongId, addPlayDurationMut]);

	// Count a listen after 60 seconds of playback
	useEffect(() => {
		if (!currentSongId || !isPlaying) return;
		if (currentTime >= 60 && listenRecordedRef.current !== currentSongId) {
			listenRecordedRef.current = currentSongId;
			addListenMut({ id: currentSongId });
		}
	}, [currentTime, currentSongId, isPlaying, addListenMut]);
}
