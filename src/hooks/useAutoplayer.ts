import { useEffect, useCallback } from 'react'
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

  const { currentSongId } = useStore(playerStore)
  const updateSessionStatus = useMutation(api.sessions.updateStatus)
  const createPending = useMutation(api.songs.createPending)

  const handleSongEnded = useCallback(() => {
    if (!songs) return
    const currentIndex = songs.findIndex((s) => s._id === currentSongId)
    if (currentIndex === -1) return
    const nextSong = songs.slice(currentIndex + 1).find((s) => s.status === 'ready')
    if (nextSong) {
      setCurrentSong(nextSong._id)
    }
  }, [songs, currentSongId])

  const { loadAndPlay, seek, play, pause, toggle } = useAudioPlayer(handleSongEnded)

  // Set session in store
  useEffect(() => {
    setSession(sessionId)
  }, [sessionId])

  // Auto-play when a song becomes ready and nothing is playing
  useEffect(() => {
    if (!songs || !sessionId) return
    if (playerStore.state.isPlaying) return

    const currentSong = currentSongId
      ? songs.find((s) => s._id === currentSongId)
      : null

    if (!currentSong || currentSong.status === 'played') {
      const nextReady = songs.find((s) => s.status === 'ready')
      if (nextReady && nextReady.audioUrl) {
        setCurrentSong(nextReady._id)
        loadAndPlay(nextReady.audioUrl)
      }
    }
  }, [songs, currentSongId, sessionId, loadAndPlay])

  // Auto-play when current song changes and has audio
  useEffect(() => {
    if (!currentSongId || !songs) return
    const song = songs.find((s) => s._id === currentSongId)
    if (song?.status === 'ready' && song.audioUrl) {
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

  const skipToNext = useCallback(() => {
    if (!songs || !currentSongId) return
    const currentIndex = songs.findIndex((s) => s._id === currentSongId)
    const nextReady = songs.slice(currentIndex + 1).find((s) => s.status === 'ready')
    if (nextReady) {
      setCurrentSong(nextReady._id)
    }
  }, [songs, currentSongId])

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

  return {
    songs,
    session,
    play,
    pause,
    toggle,
    seek,
    skipToNext,
    requestSong,
    loadAndPlay,
  }
}
