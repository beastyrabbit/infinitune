import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef } from "react";
import {
	getGlobalAudio,
	playerStore,
	setCurrentTime,
	setPlaying,
} from "@/lib/player-store";

export function useAudioPlayer(onEnded?: () => void) {
	const onEndedRef = useRef(onEnded);
	const currentUrlRef = useRef<string | null>(null);
	const { isPlaying, volume, isMuted } = useStore(playerStore);

	// Keep onEnded ref up to date without recreating Audio element
	useEffect(() => {
		onEndedRef.current = onEnded;
	}, [onEnded]);

	// Attach/detach the ended listener when this hook mounts/unmounts
	useEffect(() => {
		const audio = getGlobalAudio();
		const handleEnded = () => {
			setPlaying(false);
			onEndedRef.current?.();
		};
		audio.addEventListener("ended", handleEnded);
		return () => {
			audio.removeEventListener("ended", handleEnded);
		};
	}, []);

	// Sync volume
	useEffect(() => {
		const audio = getGlobalAudio();
		audio.volume = isMuted ? 0 : volume;
	}, [volume, isMuted]);

	// Sync play/pause
	useEffect(() => {
		const audio = getGlobalAudio();
		if (isPlaying) {
			audio.play().catch(console.error);
		} else {
			audio.pause();
		}
	}, [isPlaying]);

	const loadAndPlay = useCallback((url: string) => {
		const audio = getGlobalAudio();
		// Skip if already loaded with this URL (prevents Convex reactivity from resetting playback)
		if (url === currentUrlRef.current) return;
		currentUrlRef.current = url;
		audio.src = url;
		audio.load();
		audio.play().catch(console.error);
		setPlaying(true);
	}, []);

	const seek = useCallback((time: number) => {
		const audio = getGlobalAudio();
		audio.currentTime = time;
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

	return { loadAndPlay, seek, play, pause, toggle };
}
