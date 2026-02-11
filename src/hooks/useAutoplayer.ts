import { useEffect, useCallback, useRef } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useStore } from '@tanstack/react-store'
import { api } from '../../convex/_generated/api'
import { playerStore, setCurrentSong, setSession } from '@/lib/player-store'
import { useAudioPlayer } from './useAudioPlayer'

export function useAutoplayer(sessionId: string | null) {
  const songs = useQuery(
    api.songs.getQueue,
    sessionId ? { sessionId: sessionId as any } : 'skip',
  )
  const session = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as any } : 'skip',
  )

  const { currentSongId, isPlaying, currentTime } = useStore(playerStore)
  const updateSessionStatus = useMutation(api.sessions.updateStatus)
  const updateCurrentPosition = useMutation(api.sessions.updateCurrentPosition)
  const updateSongStatus = useMutation(api.songs.updateStatus)
  const createPending = useMutation(api.songs.createPending)
  const setRatingMut = useMutation(api.songs.setRating)
  const addPlayDurationMut = useMutation(api.songs.addPlayDuration)
  const addListenMut = useMutation(api.songs.addListen)

  // Require user interaction before auto-playing (prevents autoplay on page load)
  const userHasInteractedRef = useRef(false)

  // Track which song ID we've already loaded to avoid re-triggering on Convex updates
  const loadedSongIdRef = useRef<string | null>(null)

  // Play duration tracking
  const playStartRef = useRef<{ songId: string; startedAt: number } | null>(null)

  // Listen tracking — record which song ID already got a listen this play session
  const listenRecordedRef = useRef<string | null>(null)

  useEffect(() => {
    // Flush previous play session
    const prev = playStartRef.current
    if (prev) {
      const elapsed = Date.now() - prev.startedAt
      if (elapsed > 1000) {
        addPlayDurationMut({ id: prev.songId as any, durationMs: elapsed })
      }
      playStartRef.current = null
    }

    // Start new play session
    if (isPlaying && currentSongId) {
      playStartRef.current = { songId: currentSongId, startedAt: Date.now() }
    }

    // Reset listen tracking when song changes
    if (currentSongId !== listenRecordedRef.current) {
      listenRecordedRef.current = null
    }

    // Flush on unmount
    return () => {
      const cur = playStartRef.current
      if (cur) {
        const elapsed = Date.now() - cur.startedAt
        if (elapsed > 1000) {
          addPlayDurationMut({ id: cur.songId as any, durationMs: elapsed })
        }
        playStartRef.current = null
      }
    }
  }, [isPlaying, currentSongId, addPlayDurationMut])

  // Count a listen after 60 seconds of playback
  useEffect(() => {
    if (!currentSongId || !isPlaying) return
    if (currentTime >= 60 && listenRecordedRef.current !== currentSongId) {
      listenRecordedRef.current = currentSongId
      addListenMut({ id: currentSongId as any })
    }
  }, [currentTime, currentSongId, isPlaying, addListenMut])

  // Update session's current position when song changes (for buffer calculation)
  useEffect(() => {
    if (!currentSongId || !songs || !sessionId) return
    const song = songs.find((s) => s._id === currentSongId)
    if (song) {
      updateCurrentPosition({ id: sessionId as any, currentOrderIndex: song.orderIndex })
    }
  }, [currentSongId, songs, sessionId, updateCurrentPosition])

  const handleSongEnded = useCallback(() => {
    userHasInteractedRef.current = true
    if (!songs) return
    const currentIndex = songs.findIndex((s) => s._id === currentSongId)
    if (currentIndex === -1) return

    // Mark ended song as played (for auto-play resume on refresh)
    const endedSong = songs[currentIndex]
    if (endedSong && endedSong.status === 'ready') {
      updateSongStatus({ id: endedSong._id as any, status: 'played' })
    }

    const nextSong = songs.slice(currentIndex + 1).find((s) => s.status === 'ready')
    if (nextSong) {
      setCurrentSong(nextSong._id)
    }
  }, [songs, currentSongId, updateSongStatus])

  const { loadAndPlay, seek, play, pause, toggle } = useAudioPlayer(handleSongEnded)

  // Set session in store
  useEffect(() => {
    setSession(sessionId)
  }, [sessionId])

  // Auto-play when a song becomes ready and nothing is playing (requires user interaction first)
  useEffect(() => {
    if (!userHasInteractedRef.current) return
    if (!songs || !sessionId) return
    if (playerStore.state.isPlaying) return

    const currentSong = currentSongId
      ? songs.find((s) => s._id === currentSongId)
      : null

    // Only auto-play if no current song selected
    if (!currentSong) {
      const nextReady = songs.find((s) => s.status === 'ready')
      if (nextReady && nextReady.audioUrl) {
        setCurrentSong(nextReady._id)
        loadAndPlay(nextReady.audioUrl)
      }
    }
  }, [songs, currentSongId, sessionId, loadAndPlay])

  // Auto-play when current song changes and has audio (requires user interaction first)
  useEffect(() => {
    if (!userHasInteractedRef.current) return
    if (!currentSongId || !songs) return
    // Only load when the song ID actually changes, not on every Convex update
    if (currentSongId === loadedSongIdRef.current) return
    const song = songs.find((s) => s._id === currentSongId)
    if (song?.status === 'ready' && song.audioUrl) {
      loadedSongIdRef.current = currentSongId
      loadAndPlay(song.audioUrl)
    }
  }, [currentSongId, songs, loadAndPlay])

  // Auto-close: when session is 'closing' and no songs are in transient state, set to 'closed'
  useEffect(() => {
    if (!session || session.status !== 'closing' || !songs || !sessionId) return

    const transientStatuses = [
      'pending',
      'generating_metadata',
      'metadata_ready',
      'submitting_to_ace',
      'generating_audio',
      'saving',
    ]
    const stillActive = songs.some((s) => transientStatuses.includes(s.status))

    if (!stillActive) {
      updateSessionStatus({ id: sessionId as any, status: 'closed' })
    }
  }, [session, songs, sessionId, updateSessionStatus])

  const userPlay = useCallback(() => {
    userHasInteractedRef.current = true
    play()
  }, [play])

  const userToggle = useCallback(() => {
    userHasInteractedRef.current = true
    toggle()
  }, [toggle])

  const userLoadAndPlay = useCallback((url: string) => {
    userHasInteractedRef.current = true
    loadAndPlay(url)
  }, [loadAndPlay])

  const skipToNext = useCallback(() => {
    userHasInteractedRef.current = true
    if (!songs || !currentSongId) return
    const currentIndex = songs.findIndex((s) => s._id === currentSongId)
    // Mark skipped song as played
    const skippedSong = songs[currentIndex]
    if (skippedSong && skippedSong.status === 'ready') {
      updateSongStatus({ id: skippedSong._id as any, status: 'played' })
    }
    const nextReady = songs.slice(currentIndex + 1).find((s) => s.status === 'ready')
    if (nextReady) {
      setCurrentSong(nextReady._id)
    }
  }, [songs, currentSongId, updateSongStatus])

  const requestSong = useCallback(
    async (interruptPrompt: string) => {
      if (!session || !sessionId || !songs) return
      const currentSong = songs.find((s) => s._id === currentSongId)
      const orderIndex = currentSong ? currentSong.orderIndex + 0.5 : songs.length + 1
      await createPending({
        sessionId: sessionId as any,
        orderIndex,
        isInterrupt: true,
        interruptPrompt,
      })
    },
    [session, sessionId, songs, currentSongId, createPending],
  )

  const rateSong = useCallback(
    (songId: string, rating: 'up' | 'down') => {
      setRatingMut({ id: songId as any, rating })
    },
    [setRatingMut],
  )

  return {
    songs,
    session,
    play: userPlay,
    pause,
    toggle: userToggle,
    seek,
    skipToNext,
    requestSong,
    loadAndPlay: userLoadAndPlay,
    rateSong,
  }
}
