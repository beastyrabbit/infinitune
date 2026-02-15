import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	useCreatePending,
	usePlaylist,
	useSetRating,
	useSongQueue,
	useUpdateSongStatus,
} from "@/integrations/api/hooks";
import { pickNextSong } from "@/lib/pick-next-song";
import { playerStore, setCurrentSong, setPlaylist } from "@/lib/player-store";
import { useAudioPlayer } from "./useAudioPlayer";
import { useAutoplay } from "./useAutoplay";
import { usePlaybackTracking } from "./usePlaybackTracking";
import { usePlaylistLifecycle } from "./usePlaylistLifecycle";

export function useAutoplayer(playlistId: string | null) {
	// --- Data loading ---
	const songs = useSongQueue(playlistId);
	const playlist = usePlaylist(playlistId);

	const { currentSongId, isPlaying, currentTime } = useStore(playerStore);
	const updateSongStatus = useUpdateSongStatus();
	const createPending = useCreatePending();
	const setRatingMut = useSetRating();

	// User interaction gate — prevents auto-play on page load
	const userHasInteractedRef = useRef(false);
	// Tracks explicit user pause — prevents updates from overriding pause
	const userPausedRef = useRef(false);

	// When user manually picks a song, the epoch transition is over —
	// skip/end should respect position order, not epoch priority.
	// State drives re-renders; ref provides a stable value for callbacks
	// (handleSongEnded, skipToNext) that would otherwise capture stale state.
	const [transitionDismissed, setTransitionDismissed] = useState(false);
	const transitionDismissedRef = useRef(false);

	// Reset when epoch changes (new steer direction)
	const epochRef = useRef(playlist?.promptEpoch ?? 0);
	useEffect(() => {
		const epoch = playlist?.promptEpoch ?? 0;
		if (epoch !== epochRef.current) {
			epochRef.current = epoch;
			transitionDismissedRef.current = false;
			setTransitionDismissed(false);
		}
	}, [playlist?.promptEpoch]);

	const dismissTransition = useCallback(() => {
		transitionDismissedRef.current = true;
		setTransitionDismissed(true);
	}, []);

	// Ref to break the circular dep: handleSongEnded needs loadAndPlay,
	// but loadAndPlay comes from useAudioPlayer which takes handleSongEnded.
	const loadAndPlayRef = useRef<((url: string) => void) | undefined>(undefined);

	const handleSongEnded = useCallback(() => {
		userHasInteractedRef.current = true;
		userPausedRef.current = false;
		if (!songs) return;
		// Read fresh from store — closure value may be stale after manual song selection
		const liveSongId = playerStore.state.currentSongId;
		const endedSong = songs.find((s) => s.id === liveSongId);
		if (!endedSong) return;

		if (endedSong.status === "ready") {
			updateSongStatus({ id: endedSong.id, status: "played" });
		}

		const nextSong = pickNextSong(
			songs,
			liveSongId,
			playlist?.promptEpoch ?? 0,
			endedSong.orderIndex,
			transitionDismissedRef.current,
		);
		if (nextSong) {
			setCurrentSong(nextSong.id);
			if (nextSong.audioUrl) loadAndPlayRef.current?.(nextSong.audioUrl);
		} else {
			setCurrentSong(null);
		}
	}, [songs, playlist?.promptEpoch, updateSongStatus]);

	const { loadAndPlay, seek, play, pause, toggle } =
		useAudioPlayer(handleSongEnded);
	loadAndPlayRef.current = loadAndPlay;

	// --- Composed hooks ---
	usePlaybackTracking(currentSongId, isPlaying, currentTime);
	usePlaylistLifecycle(playlistId, playlist, songs, currentSongId);
	useAutoplay(
		songs,
		playlistId,
		currentSongId,
		loadAndPlay,
		userHasInteractedRef,
		userPausedRef,
		playlist,
		transitionDismissedRef,
	);

	// Set playlist in store
	useEffect(() => {
		setPlaylist(playlistId);
	}, [playlistId]);

	// --- User-facing actions ---
	const userPlay = useCallback(() => {
		userHasInteractedRef.current = true;
		userPausedRef.current = false;
		play();
	}, [play]);

	const userPause = useCallback(() => {
		userPausedRef.current = true;
		pause();
	}, [pause]);

	const userToggle = useCallback(() => {
		userHasInteractedRef.current = true;
		userPausedRef.current = playerStore.state.isPlaying; // toggling from play→pause
		toggle();
	}, [toggle]);

	const userLoadAndPlay = useCallback(
		(url: string) => {
			userHasInteractedRef.current = true;
			userPausedRef.current = false;
			loadAndPlay(url);
		},
		[loadAndPlay],
	);

	const skipToNext = useCallback(() => {
		userHasInteractedRef.current = true;
		userPausedRef.current = false;
		// Read fresh from store — closure value may be stale after manual song selection
		const liveSongId = playerStore.state.currentSongId;
		if (!songs || !liveSongId) return;
		const skippedSong = songs.find((s) => s.id === liveSongId);
		if (skippedSong && skippedSong.status === "ready") {
			updateSongStatus({ id: skippedSong.id, status: "played" });
		}
		const nextSong = pickNextSong(
			songs,
			liveSongId,
			playlist?.promptEpoch ?? 0,
			skippedSong?.orderIndex,
			transitionDismissedRef.current,
		);
		if (nextSong) {
			setCurrentSong(nextSong.id);
			if (nextSong.audioUrl) loadAndPlay(nextSong.audioUrl);
		}
	}, [songs, playlist?.promptEpoch, updateSongStatus, loadAndPlay]);

	const requestSong = useCallback(
		async (interruptPrompt: string) => {
			if (!playlist || !playlistId || !songs) return;
			const currentSong = songs.find((s) => s.id === currentSongId);
			const orderIndex = currentSong
				? currentSong.orderIndex + 0.5
				: songs.length + 1;
			await createPending({
				playlistId,
				orderIndex,
				isInterrupt: true,
				interruptPrompt,
				promptEpoch: playlist.promptEpoch ?? 0,
			});
		},
		[playlist, playlistId, songs, currentSongId, createPending],
	);

	const rateSong = useCallback(
		(songId: string, rating: "up" | "down") => {
			setRatingMut({ id: songId, rating });
		},
		[setRatingMut],
	);

	return {
		songs,
		playlist,
		play: userPlay,
		pause: userPause,
		toggle: userToggle,
		seek,
		skipToNext,
		requestSong,
		loadAndPlay: userLoadAndPlay,
		rateSong,
		transitionDismissed,
		dismissTransition,
	};
}
