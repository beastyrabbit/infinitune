import { useStore } from "@tanstack/react-store";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { asSongId } from "@/lib/convex-helpers";
import { playerStore, setCurrentSong, setPlaylist } from "@/lib/player-store";
import type { Id } from "@/types/convex";
import { api } from "../../convex/_generated/api";
import { useAudioPlayer } from "./useAudioPlayer";
import { useAutoplay } from "./useAutoplay";
import { usePlaybackTracking } from "./usePlaybackTracking";
import { usePlaylistLifecycle } from "./usePlaylistLifecycle";

export function useAutoplayer(playlistId: Id<"playlists"> | null) {
	// --- Data loading ---
	const songs = useQuery(
		api.songs.getQueue,
		playlistId ? { playlistId } : "skip",
	);
	const playlist = useQuery(
		api.playlists.get,
		playlistId ? { id: playlistId } : "skip",
	);

	const { currentSongId, isPlaying, currentTime } = useStore(playerStore);
	const updateSongStatus = useMutation(api.songs.updateStatus);
	const createPending = useMutation(api.songs.createPending);
	const setRatingMut = useMutation(api.songs.setRating);

	// User interaction gate — prevents auto-play on page load
	const userHasInteractedRef = useRef(false);

	const handleSongEnded = useCallback(() => {
		userHasInteractedRef.current = true;
		if (!songs) return;
		const currentIndex = songs.findIndex((s) => s._id === currentSongId);
		if (currentIndex === -1) return;

		const endedSong = songs[currentIndex];
		if (endedSong && endedSong.status === "ready") {
			updateSongStatus({ id: endedSong._id, status: "played" });
		}

		const nextSong = songs
			.slice(currentIndex + 1)
			.find((s) => s.status === "ready");
		if (nextSong) {
			setCurrentSong(nextSong._id);
		}
	}, [songs, currentSongId, updateSongStatus]);

	const { loadAndPlay, seek, play, pause, toggle } =
		useAudioPlayer(handleSongEnded);

	// --- Composed hooks ---
	usePlaybackTracking(currentSongId, isPlaying, currentTime);
	usePlaylistLifecycle(playlistId, playlist, songs, currentSongId);
	useAutoplay(
		songs,
		playlistId,
		currentSongId,
		loadAndPlay,
		userHasInteractedRef,
	);

	// Set playlist in store
	useEffect(() => {
		setPlaylist(playlistId);
	}, [playlistId]);

	// --- User-facing actions ---
	const userPlay = useCallback(() => {
		userHasInteractedRef.current = true;
		play();
	}, [play]);

	const userToggle = useCallback(() => {
		userHasInteractedRef.current = true;
		toggle();
	}, [toggle]);

	const userLoadAndPlay = useCallback(
		(url: string) => {
			userHasInteractedRef.current = true;
			loadAndPlay(url);
		},
		[loadAndPlay],
	);

	const skipToNext = useCallback(() => {
		userHasInteractedRef.current = true;
		if (!songs || !currentSongId) return;
		const currentIndex = songs.findIndex((s) => s._id === currentSongId);
		const skippedSong = songs[currentIndex];
		if (skippedSong && skippedSong.status === "ready") {
			updateSongStatus({ id: skippedSong._id, status: "played" });
		}
		const nextReady = songs
			.slice(currentIndex + 1)
			.find((s) => s.status === "ready");
		if (nextReady) {
			setCurrentSong(nextReady._id);
		}
	}, [songs, currentSongId, updateSongStatus]);

	const requestSong = useCallback(
		async (interruptPrompt: string) => {
			if (!playlist || !playlistId || !songs) return;
			const currentSong = songs.find((s) => s._id === currentSongId);
			const orderIndex = currentSong
				? currentSong.orderIndex + 0.5
				: songs.length + 1;
			await createPending({
				playlistId,
				orderIndex,
				isInterrupt: true,
				interruptPrompt,
			});
		},
		[playlist, playlistId, songs, currentSongId, createPending],
	);

	const rateSong = useCallback(
		(songId: string, rating: "up" | "down") => {
			setRatingMut({ id: asSongId(songId), rating });
		},
		[setRatingMut],
	);

	return {
		songs,
		playlist,
		play: userPlay,
		pause,
		toggle: userToggle,
		seek,
		skipToNext,
		requestSong,
		loadAndPlay: userLoadAndPlay,
		rateSong,
	};
}
