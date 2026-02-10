import { Store } from '@tanstack/store'

export interface PlayerState {
  isPlaying: boolean
  volume: number // 0-1
  currentTime: number // seconds
  duration: number // seconds
  currentSongId: string | null // Convex song ID
  sessionId: string | null // Convex session ID
  isMuted: boolean
}

export const playerStore = new Store<PlayerState>({
  isPlaying: false,
  volume: 0.8,
  currentTime: 0,
  duration: 0,
  currentSongId: null,
  sessionId: null,
  isMuted: false,
})

export function setPlaying(isPlaying: boolean) {
  playerStore.setState((state) => ({ ...state, isPlaying }))
}

export function setVolume(volume: number) {
  playerStore.setState((state) => ({ ...state, volume, isMuted: volume === 0 }))
}

export function setCurrentTime(currentTime: number) {
  playerStore.setState((state) => ({ ...state, currentTime }))
}

export function setDuration(duration: number) {
  playerStore.setState((state) => ({ ...state, duration }))
}

export function setCurrentSong(songId: string | null) {
  playerStore.setState((state) => ({ ...state, currentSongId: songId, currentTime: 0 }))
}

export function setSession(sessionId: string | null) {
  playerStore.setState((state) => ({ ...state, sessionId }))
}

export function toggleMute() {
  playerStore.setState((state) => ({ ...state, isMuted: !state.isMuted }))
}
