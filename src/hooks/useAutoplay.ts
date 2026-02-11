import { type MutableRefObject, useEffect, useRef } from "react";
import { playerStore, setCurrentSong } from "@/lib/player-store";
import type { Id, Song } from "@/types/convex";

/**
 * Auto-plays songs when they become ready, gated on prior user interaction.
 * - Selects the next ready song when nothing is playing.
 * - Loads audio when the current song changes.
 */
export function useAutoplay(
	songs: Song[] | undefined,
	playlistId: Id<"playlists"> | null,
	currentSongId: string | null,
	loadAndPlay: (url: string) => void,
	userHasInteractedRef: MutableRefObject<boolean>,
) {
	const loadedSongIdRef = useRef<string | null>(null);

	// Auto-play when a song becomes ready and nothing is playing
	useEffect(() => {
		if (!userHasInteractedRef.current) return;
		if (!songs || !playlistId) return;
		if (playerStore.state.isPlaying) return;

		const currentSong = currentSongId
			? songs.find((s) => s._id === currentSongId)
			: null;

		if (!currentSong) {
			const nextReady = songs.find((s) => s.status === "ready");
			if (nextReady?.audioUrl) {
				setCurrentSong(nextReady._id);
				loadAndPlay(nextReady.audioUrl);
			}
		}
	}, [songs, currentSongId, playlistId, loadAndPlay, userHasInteractedRef]);

	// Auto-play when current song changes and has audio
	useEffect(() => {
		if (!userHasInteractedRef.current) return;
		if (!currentSongId || !songs) return;
		if (currentSongId === loadedSongIdRef.current) return;
		const song = songs.find((s) => s._id === currentSongId);
		if (song?.status === "ready" && song.audioUrl) {
			loadedSongIdRef.current = currentSongId;
			loadAndPlay(song.audioUrl);
		}
	}, [currentSongId, songs, loadAndPlay, userHasInteractedRef]);
}
