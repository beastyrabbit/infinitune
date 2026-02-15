import { Store } from "@tanstack/store";

// ─── Local Storage Persistence ──────────────────────────────────────
const STORAGE_KEY = "infinitune-player";

interface PersistedState {
	volume: number;
	isMuted: boolean;
}

function loadPersistedState(): PersistedState {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<PersistedState>;
			return {
				volume: typeof parsed.volume === "number" ? parsed.volume : 0.8,
				isMuted: typeof parsed.isMuted === "boolean" ? parsed.isMuted : false,
			};
		}
	} catch {
		// Ignore corrupt localStorage
	}
	return { volume: 0.8, isMuted: false };
}

function persistState(state: PersistedState): void {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ volume: state.volume, isMuted: state.isMuted }),
		);
	} catch {
		// localStorage full or unavailable
	}
}

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

const persisted = loadPersistedState();

export const playerStore = new Store<PlayerState>({
	isPlaying: false,
	volume: persisted.volume,
	currentTime: 0,
	duration: 0,
	currentSongId: null,
	playlistId: null,
	isMuted: persisted.isMuted,
});

export function setPlaying(isPlaying: boolean) {
	playerStore.setState((state) => ({ ...state, isPlaying }));
}

export function setVolume(volume: number) {
	const next = { volume, isMuted: volume === 0 };
	playerStore.setState((state) => ({ ...state, ...next }));
	persistState(next);
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
	playerStore.setState((state) => {
		const next = { ...state, isMuted: !state.isMuted };
		persistState(next);
		return next;
	});
}

export function stopPlayback() {
	if (globalAudio) {
		globalAudio.pause();
		globalAudio.src = "";
	}
	playerStore.setState((state) => ({
		...state,
		isPlaying: false,
		currentSongId: null,
		currentTime: 0,
		duration: 0,
	}));
}
