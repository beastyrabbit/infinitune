import { type MutableRefObject, useEffect, useRef } from "react";
import { pickNextSong } from "@/lib/pick-next-song";
import { playerStore, setCurrentSong } from "@/lib/player-store";
import type { Id, Playlist, Song } from "@/types/convex";

/**
 * Auto-plays songs when they become ready, gated on prior user interaction.
 * - Uses pickNextSong for priority-based selection (interrupts > current-epoch > filler).
 * - Loads audio when the current song changes.
 * - Re-evaluates when a played song's successor becomes ready (gap recovery).
 */
export function useAutoplay(
	songs: Song[] | undefined,
	playlistId: Id<"playlists"> | null,
	currentSongId: string | null,
	loadAndPlay: (url: string) => void,
	userHasInteractedRef: MutableRefObject<boolean>,
	playlist: Playlist | null | undefined,
) {
	const loadedSongIdRef = useRef<string | null>(null);

	// Auto-play when a song becomes ready and nothing is playing,
	// or when the current song has been played and a new one is available
	useEffect(() => {
		if (!userHasInteractedRef.current) return;
		if (!songs || !playlistId) return;
		if (playerStore.state.isPlaying) return;

		const currentSong = currentSongId
			? songs.find((s) => s._id === currentSongId)
			: null;

		const shouldPick = !currentSong || currentSong.status === "played";
		if (shouldPick) {
			const next = pickNextSong(
				songs,
				currentSongId,
				playlist?.promptEpoch ?? 0,
				currentSong?.orderIndex,
			);
			if (next?.audioUrl) {
				setCurrentSong(next._id);
				loadAndPlay(next.audioUrl);
			}
		}
	}, [
		songs,
		currentSongId,
		playlistId,
		loadAndPlay,
		userHasInteractedRef,
		playlist?.promptEpoch,
	]);

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
