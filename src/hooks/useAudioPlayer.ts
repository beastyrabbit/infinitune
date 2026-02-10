import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef } from "react";
import {
	playerStore,
	setCurrentTime,
	setDuration,
	setPlaying,
} from "@/lib/player-store";

export function useAudioPlayer(onEnded?: () => void) {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const currentUrlRef = useRef<string | null>(null);
	const onEndedRef = useRef(onEnded);
	const { isPlaying, volume, isMuted } = useStore(playerStore);

	// Keep onEnded ref up to date without recreating Audio element
	useEffect(() => {
		onEndedRef.current = onEnded;
	}, [onEnded]);

	// Create audio element once on mount
	useEffect(() => {
		const audio = new Audio();
		audioRef.current = audio;

		audio.addEventListener("timeupdate", () => {
			setCurrentTime(audio.currentTime);
		});

		audio.addEventListener("loadedmetadata", () => {
			setDuration(audio.duration);
		});

		audio.addEventListener("ended", () => {
			setPlaying(false);
			onEndedRef.current?.();
		});

		audio.addEventListener("error", (e) => {
			console.error("Audio error:", e);
			setPlaying(false);
		});

		return () => {
			audio.pause();
			audio.src = "";
		};
	}, []);

	// Sync volume
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.volume = isMuted ? 0 : volume;
		}
	}, [volume, isMuted]);

	// Sync play/pause
	useEffect(() => {
		if (!audioRef.current) return;
		if (isPlaying) {
			audioRef.current.play().catch(console.error);
		} else {
			audioRef.current.pause();
		}
	}, [isPlaying]);

	const loadAndPlay = useCallback((url: string) => {
		if (!audioRef.current) return;
		// Skip reload if already playing this URL (prevents Convex reactivity from resetting playback)
		if (url === currentUrlRef.current) {
			if (audioRef.current.paused) {
				audioRef.current.play().catch(console.error);
				setPlaying(true);
			}
			return;
		}
		currentUrlRef.current = url;
		audioRef.current.src = url;
		audioRef.current.load();
		audioRef.current.play().catch(console.error);
		setPlaying(true);
	}, []);

	const seek = useCallback((time: number) => {
		if (!audioRef.current) return;
		audioRef.current.currentTime = time;
		setCurrentTime(time);
	}, []);

	const play = useCallback(() => {
		setPlaying(true);
	}, []);

	const pause = useCallback(() => {
		setPlaying(false);
	}, []);

	const toggle = useCallback(() => {
		setPlaying(!playerStore.state.isPlaying);
	}, []);

	return { loadAndPlay, seek, play, pause, toggle, audioRef };
}
