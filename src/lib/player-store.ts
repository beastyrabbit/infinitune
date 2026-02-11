import { Store } from "@tanstack/store";

// ─── Global Audio Singleton ──────────────────────────────────────────
// Lives outside React lifecycle so it survives route changes
let globalAudio: HTMLAudioElement | null = null;
let globalAudioInitialized = false;

export function getGlobalAudio(): HTMLAudioElement {
	if (!globalAudio) {
		globalAudio = new Audio();
	}
	if (!globalAudioInitialized) {
		globalAudioInitialized = true;
		globalAudio.addEventListener("timeupdate", () => {
			setCurrentTime(globalAudio?.currentTime ?? 0);
		});
		globalAudio.addEventListener("loadedmetadata", () => {
			setDuration(globalAudio?.duration ?? 0);
		});
		globalAudio.addEventListener("error", (e) => {
			console.error("Audio error:", e);
			setPlaying(false);
		});
	}
	return globalAudio;
}

export interface PlayerState {
	isPlaying: boolean;
	volume: number; // 0-1
	currentTime: number; // seconds
	duration: number; // seconds
	currentSongId: string | null; // Convex song ID
	playlistId: string | null; // Convex playlist ID
	isMuted: boolean;
}

export const playerStore = new Store<PlayerState>({
	isPlaying: false,
	volume: 0.8,
	currentTime: 0,
	duration: 0,
	currentSongId: null,
	playlistId: null,
	isMuted: false,
});

export function setPlaying(isPlaying: boolean) {
	playerStore.setState((state) => ({ ...state, isPlaying }));
}

export function setVolume(volume: number) {
	playerStore.setState((state) => ({
		...state,
		volume,
		isMuted: volume === 0,
	}));
}

export function setCurrentTime(currentTime: number) {
	playerStore.setState((state) => ({ ...state, currentTime }));
}

export function setDuration(duration: number) {
	playerStore.setState((state) => ({ ...state, duration }));
}

export function setCurrentSong(songId: string | null) {
	playerStore.setState((state) => ({
		...state,
		currentSongId: songId,
		currentTime: 0,
	}));
}

export function setPlaylist(playlistId: string | null) {
	playerStore.setState((state) => ({ ...state, playlistId }));
}

export function toggleMute() {
	playerStore.setState((state) => ({ ...state, isMuted: !state.isMuted }));
}
