import { useEffect, useCallback, useRef } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useStore } from '@tanstack/react-store'
import { api } from '../../convex/_generated/api'
import { playerStore, setCurrentSong, setSession } from '@/lib/player-store'
import { useAudioPlayer } from './useAudioPlayer'
import { useGenerationPipeline } from './useGenerationPipeline'

const BUFFER_SIZE = 2

interface ModelSettings {
  imageProvider?: string
  imageModel?: string
  aceModel?: string
}

export function useAutoplayer(sessionId: string | null, modelSettings?: ModelSettings) {
  const songs = useQuery(
    api.songs.getQueue,
    sessionId ? { sessionId: sessionId as any } : 'skip',
  )
  const session = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as any } : 'skip',
  )
  const cancelledSongs = useQuery(
    api.songs.getCancelledForResume,
    sessionId ? { sessionId: sessionId as any } : 'skip',
  )
  const retryPendingSongs = useQuery(
    api.songs.getRetryPending,
    sessionId ? { sessionId: sessionId as any } : 'skip',
  )

  const { currentSongId } = useStore(playerStore)
  const { generate, resumeSong, abort } = useGenerationPipeline()
  const updateSessionStatus = useMutation(api.sessions.updateStatus)
  const markRetrying = useMutation(api.songs.markRetrying)
  const isGeneratingRef = useRef(false)
  const hasResumedRef = useRef<string | null>(null)

  const handleSongEnded = useCallback(() => {
    if (!songs) return

    // Find current song index
    const currentIndex = songs.findIndex((s) => s._id === currentSongId)
    if (currentIndex === -1) return

    // Find next ready song
    const nextSong = songs.slice(currentIndex + 1).find((s) => s.status === 'ready')
    if (nextSong) {
      setCurrentSong(nextSong._id)
    }
  }, [songs, currentSongId])

  const { loadAndPlay, seek, play, pause, toggle } = useAudioPlayer(handleSongEnded)

  // Set session in store and reset resume tracking
  useEffect(() => {
    setSession(sessionId)
    hasResumedRef.current = null
  }, [sessionId])

  // Auto-play when a song becomes ready and nothing is playing
  useEffect(() => {
    if (!songs || !sessionId) return
    if (playerStore.state.isPlaying) return

    const currentSong = currentSongId
      ? songs.find((s) => s._id === currentSongId)
      : null

    // If no current song or current song is done, find next ready
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

  // Auto-close: when session is 'closing' and no songs are generating, set to 'closed'
  useEffect(() => {
    if (!session || session.status !== 'closing' || !songs || !sessionId) return

    const activeStatuses = [
      'generating_metadata',
      'submitting_to_ace',
      'generating_audio',
      'saving',
    ]
    const stillGenerating = songs.some((s) => activeStatuses.includes(s.status))

    if (!stillGenerating) {
      updateSessionStatus({ id: sessionId as any, status: 'closed' })
    }
  }, [session, songs, sessionId, updateSessionStatus])

  // Resume cancelled songs when session becomes active again
  useEffect(() => {
    if (!session || session.status !== 'active' || !sessionId) return
    if (!cancelledSongs || cancelledSongs.length === 0) return
    // Only resume once per session activation (avoid re-triggering on every render)
    if (hasResumedRef.current === sessionId) return
    hasResumedRef.current = sessionId

    // Resume cancelled songs sequentially
    const resumeAll = async () => {
      for (const song of cancelledSongs) {
        if (isGeneratingRef.current) {
          // Wait for current generation to finish before resuming next
          await new Promise<void>((resolve) => {
            const check = () => {
              if (!isGeneratingRef.current) resolve()
              else setTimeout(check, 1000)
            }
            check()
          })
        }
        isGeneratingRef.current = true
        try {
          await resumeSong({
            songId: song._id,
            sessionId,
            title: song.title,
            artistName: song.artistName,
            genre: song.genre,
            subGenre: song.subGenre,
            lyrics: song.lyrics,
            caption: song.caption,
            coverPrompt: song.coverPrompt,
            coverUrl: song.coverUrl,
            bpm: song.bpm,
            keyScale: song.keyScale,
            timeSignature: song.timeSignature,
            audioDuration: song.audioDuration,
            aceTaskId: song.aceTaskId,
            aceAudioPath: song.aceAudioPath,
            cancelledAtStatus: song.cancelledAtStatus!,
            imageProvider: modelSettings?.imageProvider,
            imageModel: modelSettings?.imageModel,
            aceModel: modelSettings?.aceModel,
          })
        } finally {
          isGeneratingRef.current = false
        }
      }
    }

    resumeAll()
  }, [session, sessionId, cancelledSongs, resumeSong, modelSettings])

  // Auto-retry errored songs (retry_pending status)
  useEffect(() => {
    if (!session || session.status !== 'active' || !sessionId) return
    if (!retryPendingSongs || retryPendingSongs.length === 0) return
    if (isGeneratingRef.current) return

    const song = retryPendingSongs[0]
    const maxOrder = songs?.length ? Math.max(...songs.map((s) => s.orderIndex)) : 0
    const newOrder = Math.ceil(maxOrder) + 1

    isGeneratingRef.current = true
    markRetrying({ id: song._id as any, newOrderIndex: newOrder }).then(() => {
      return resumeSong({
        songId: song._id,
        sessionId,
        title: song.title,
        artistName: song.artistName,
        genre: song.genre,
        subGenre: song.subGenre,
        lyrics: song.lyrics,
        caption: song.caption,
        coverPrompt: song.coverPrompt,
        coverUrl: song.coverUrl,
        bpm: song.bpm,
        keyScale: song.keyScale,
        timeSignature: song.timeSignature,
        audioDuration: song.audioDuration,
        aceTaskId: song.aceTaskId,
        aceAudioPath: song.aceAudioPath,
        cancelledAtStatus: song.erroredAtStatus || 'submitting_to_ace',
        imageProvider: modelSettings?.imageProvider,
        imageModel: modelSettings?.imageModel,
        aceModel: modelSettings?.aceModel,
      })
    }).finally(() => {
      isGeneratingRef.current = false
    })
  }, [retryPendingSongs, session, sessionId, songs, markRetrying, resumeSong, modelSettings])

  // Pre-generate buffer — only when session is active
  useEffect(() => {
    if (!songs || !session || session.status !== 'active') return
    if (isGeneratingRef.current) return

    const activeStatuses = [
      'ready',
      'generating_metadata',
      'submitting_to_ace',
      'generating_audio',
      'saving',
    ]
    const readySongs = songs.filter((s) => activeStatuses.includes(s.status))

    const playingSong = songs.find((s) => s._id === currentSongId)
    const songsAhead = readySongs.filter(
      (s) => !playingSong || s.orderIndex > playingSong.orderIndex,
    )

    if (songsAhead.length < BUFFER_SIZE && sessionId) {
      isGeneratingRef.current = true
      const maxOrder = songs.length > 0 ? Math.max(...songs.map((s) => s.orderIndex)) : 0
      const nextOrder = Math.ceil(maxOrder) + 1

      generate({
        sessionId,
        prompt: session.prompt,
        provider: session.llmProvider,
        model: session.llmModel,
        imageProvider: modelSettings?.imageProvider,
        imageModel: modelSettings?.imageModel,
        aceModel: modelSettings?.aceModel,
        orderIndex: nextOrder,
      }).finally(() => {
        isGeneratingRef.current = false
      })
    }
  }, [songs, session, currentSongId, sessionId, generate, modelSettings])

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

      // Find current song to set orderIndex
      const currentSong = songs.find((s) => s._id === currentSongId)
      const orderIndex = currentSong ? currentSong.orderIndex + 0.5 : songs.length + 1

      await generate({
        sessionId,
        prompt: session.prompt,
        provider: session.llmProvider,
        model: session.llmModel,
        imageProvider: modelSettings?.imageProvider,
        imageModel: modelSettings?.imageModel,
        aceModel: modelSettings?.aceModel,
        orderIndex,
        isInterrupt: true,
        interruptPrompt,
      })
    },
    [session, sessionId, songs, currentSongId, generate, modelSettings],
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
    abortGeneration: abort,
  }
}
