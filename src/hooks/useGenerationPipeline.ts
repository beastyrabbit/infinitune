import { useCallback, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'

interface GenerationOptions {
  sessionId: string
  prompt: string
  provider: string
  model: string
  imageProvider?: string
  imageModel?: string
  aceModel?: string
  orderIndex: number
  isInterrupt?: boolean
  interruptPrompt?: string
}

interface ResumeSongData {
  songId: string
  sessionId: string
  title: string
  artistName: string
  genre: string
  subGenre: string
  lyrics: string
  caption: string
  coverPrompt?: string
  coverUrl?: string
  bpm: number
  keyScale: string
  timeSignature: string
  audioDuration: number
  aceTaskId?: string
  aceAudioPath?: string
  cancelledAtStatus: string
  imageProvider?: string
  imageModel?: string
  aceModel?: string
}

export function useGenerationPipeline() {
  const createSong = useMutation(api.songs.create)
  const updateStatus = useMutation(api.songs.updateStatus)
  const updateAceTask = useMutation(api.songs.updateAceTask)
  const updateCover = useMutation(api.songs.updateCover)
  const updateStoragePath = useMutation(api.songs.updateStoragePath)
  const markReady = useMutation(api.songs.markReady)
  const markError = useMutation(api.songs.markError)
  const markResuming = useMutation(api.songs.markResuming)
  const incrementSongs = useMutation(api.sessions.incrementSongsGenerated)

  const activeGenerations = useRef<Set<string>>(new Set())
  const abortControllerRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const generate = useCallback(
    async (options: GenerationOptions) => {
      const {
        sessionId,
        prompt,
        provider,
        model,
        imageProvider,
        imageModel,
        aceModel,
        orderIndex,
        isInterrupt,
        interruptPrompt,
      } = options

      // Prevent duplicate generations
      const genKey = `${sessionId}-${orderIndex}`
      if (activeGenerations.current.has(genKey)) return
      activeGenerations.current.add(genKey)

      // Create abort controller for this generation
      const ac = new AbortController()
      abortControllerRef.current = ac
      const signal = ac.signal

      let songId: string | null = null
      let currentStep = 'generating_metadata'

      try {
        // Step 1: Generate song metadata via LLM
        const llmResponse = await fetch('/api/autoplayer/generate-song', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: interruptPrompt || prompt,
            provider,
            model,
          }),
          signal,
        })

        if (!llmResponse.ok) {
          throw new Error('LLM generation failed')
        }

        const songData = await llmResponse.json()

        if (signal.aborted) throw new Error('Generation cancelled')

        // Step 2: Create song in Convex
        songId = await createSong({
          sessionId: sessionId as any,
          orderIndex,
          title: songData.title,
          artistName: songData.artistName,
          genre: songData.genre,
          subGenre: songData.subGenre || songData.genre,
          lyrics: songData.lyrics,
          caption: songData.caption,
          coverPrompt: songData.coverPrompt,
          bpm: songData.bpm,
          keyScale: songData.keyScale,
          timeSignature: songData.timeSignature,
          audioDuration: songData.audioDuration,
          isInterrupt,
          interruptPrompt,
        })

        if (signal.aborted) throw new Error('Generation cancelled')

        // Step 3: In parallel — generate cover art + submit to ACE-Step
        currentStep = 'submitting_to_ace'
        await updateStatus({ id: songId as any, status: 'submitting_to_ace' })

        let coverBase64: string | null = null

        const [aceResult] = await Promise.allSettled([
          // 3a: Submit to ACE-Step (critical path)
          (async () => {
            const aceResponse = await fetch('/api/autoplayer/submit-ace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lyrics: songData.lyrics,
                caption: songData.caption,
                bpm: songData.bpm,
                keyScale: songData.keyScale,
                timeSignature: songData.timeSignature,
                audioDuration: songData.audioDuration,
                aceModel,
              }),
              signal,
            })

            if (!aceResponse.ok) {
              throw new Error('ACE-Step submission failed')
            }

            const aceData = await aceResponse.json()
            return aceData.taskId
          })(),

          // 3b: Generate cover art (best-effort, runs alongside ACE-Step)
          (async () => {
            if (!imageProvider || !songData.coverPrompt) return null
            if (imageProvider !== 'comfyui' && !imageModel) return null
            try {
              const coverResponse = await fetch('/api/autoplayer/generate-cover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  coverPrompt: songData.coverPrompt,
                  provider: imageProvider,
                  model: imageModel,
                }),
                signal,
              })

              if (coverResponse.ok) {
                const coverData = await coverResponse.json()
                if (coverData.imageBase64) {
                  coverBase64 = coverData.imageBase64
                  await updateCover({
                    id: songId as any,
                    coverUrl: `data:image/png;base64,${coverBase64}`,
                  })
                }
              }
            } catch {
              // Cover generation is best-effort
            }
            return null
          })(),
        ])

        if (signal.aborted) throw new Error('Generation cancelled')

        // Process ACE-Step result
        if (aceResult.status === 'rejected') {
          throw new Error(aceResult.reason?.message || 'ACE-Step submission failed')
        }
        const taskId = aceResult.value

        await updateAceTask({ id: songId as any, aceTaskId: taskId })

        // Step 4: Poll for audio completion
        currentStep = 'generating_audio'
        await updateStatus({ id: songId as any, status: 'generating_audio' })

        let attempts = 0
        const maxAttempts = 120 // ~10 minutes at 5s intervals
        let audioPath: string | null = null

        while (attempts < maxAttempts) {
          // Check abort between polls
          if (signal.aborted) throw new Error('Generation cancelled')

          await new Promise((resolve) => setTimeout(resolve, 5000))

          if (signal.aborted) throw new Error('Generation cancelled')

          const pollResponse = await fetch('/api/autoplayer/poll-ace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId }),
            signal,
          })

          if (!pollResponse.ok) {
            attempts++
            continue
          }

          const pollData = await pollResponse.json()

          if (pollData.status === 'succeeded') {
            audioPath = pollData.audioPath
            break
          } else if (pollData.status === 'failed') {
            throw new Error(pollData.error || 'Audio generation failed')
          }

          attempts++
        }

        if (signal.aborted) throw new Error('Generation cancelled')

        if (attempts >= maxAttempts) {
          throw new Error('Audio generation timed out')
        }

        if (!audioPath) {
          throw new Error('No audio path returned from ACE-Step')
        }

        // Step 5: Save to NFS
        currentStep = 'saving'
        await updateStatus({ id: songId as any, status: 'saving' })
        try {
          const saveResponse = await fetch('/api/autoplayer/save-song', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              songId,
              title: songData.title,
              artistName: songData.artistName,
              genre: songData.genre,
              subGenre: songData.subGenre || songData.genre,
              lyrics: songData.lyrics,
              caption: songData.caption,
              coverPrompt: songData.coverPrompt,
              bpm: songData.bpm,
              keyScale: songData.keyScale,
              timeSignature: songData.timeSignature,
              audioDuration: songData.audioDuration,
              aceAudioPath: audioPath,
              coverBase64,
            }),
            signal,
          })

          if (saveResponse.ok) {
            const saveData = await saveResponse.json()
            await updateStoragePath({
              id: songId as any,
              storagePath: saveData.storagePath,
              aceAudioPath: audioPath,
            })
          }
        } catch (e: any) {
          // NFS save is best-effort — don't fail the whole pipeline (unless aborted)
          if (signal.aborted) throw new Error('Generation cancelled')
          console.error('NFS save failed, continuing with ACE-Step proxy')
        }

        if (signal.aborted) throw new Error('Generation cancelled')

        // Step 6: Mark ready — audio URL points to our proxy with aceAudioPath fallback
        const encodedAudioPath = encodeURIComponent(audioPath)
        const audioUrl = `/api/autoplayer/audio/${songId}?aceAudioPath=${encodedAudioPath}`
        await markReady({ id: songId as any, audioUrl })
        await incrementSongs({ id: sessionId as any })
      } catch (error: any) {
        // Don't log abort errors as pipeline failures
        if (signal.aborted) {
          console.log('Generation pipeline cancelled')
        } else {
          console.error('Generation pipeline error:', error)
        }
        if (songId) {
          await markError({
            id: songId as any,
            errorMessage: signal.aborted ? 'Cancelled by user' : (error.message || 'Unknown error'),
            erroredAtStatus: currentStep,
          })
        }
      } finally {
        activeGenerations.current.delete(genKey)
        if (abortControllerRef.current === ac) {
          abortControllerRef.current = null
        }
      }
    },
    [createSong, updateStatus, updateAceTask, updateCover, updateStoragePath, markReady, markError, incrementSongs],
  )

  const resumeSong = useCallback(
    async (data: ResumeSongData) => {
      const { songId, sessionId } = data

      const genKey = `resume-${songId}`
      if (activeGenerations.current.has(genKey)) return
      activeGenerations.current.add(genKey)

      const ac = new AbortController()
      abortControllerRef.current = ac
      const signal = ac.signal

      let currentStep = 'submitting_to_ace'

      try {
        // Mark song as resuming (resets to submitting_to_ace)
        await markResuming({ id: songId as any })

        // Determine where to resume based on cancelledAtStatus and available data
        const needsAce = !data.aceAudioPath
        const needsCover = !data.coverUrl
        let audioPath = data.aceAudioPath || null
        let coverBase64: string | null = null

        if (needsAce) {
          // Step: Submit to ACE-Step + cover art in parallel
          await updateStatus({ id: songId as any, status: 'submitting_to_ace' })

          const [aceResult] = await Promise.allSettled([
            // Submit to ACE-Step
            (async () => {
              const aceResponse = await fetch('/api/autoplayer/submit-ace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lyrics: data.lyrics,
                  caption: data.caption,
                  bpm: data.bpm,
                  keyScale: data.keyScale,
                  timeSignature: data.timeSignature,
                  audioDuration: data.audioDuration,
                  aceModel: data.aceModel,
                }),
                signal,
              })
              if (!aceResponse.ok) throw new Error('ACE-Step submission failed')
              const aceData = await aceResponse.json()
              return aceData.taskId
            })(),

            // Generate cover art (best-effort)
            (async () => {
              if (!needsCover || !data.imageProvider || !data.coverPrompt) return null
              if (data.imageProvider !== 'comfyui' && !data.imageModel) return null
              try {
                const coverResponse = await fetch('/api/autoplayer/generate-cover', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    coverPrompt: data.coverPrompt,
                    provider: data.imageProvider,
                    model: data.imageModel,
                  }),
                  signal,
                })
                if (coverResponse.ok) {
                  const coverData = await coverResponse.json()
                  if (coverData.imageBase64) {
                    coverBase64 = coverData.imageBase64
                    await updateCover({
                      id: songId as any,
                      coverUrl: `data:image/png;base64,${coverBase64}`,
                    })
                  }
                }
              } catch {
                // Best-effort
              }
              return null
            })(),
          ])

          if (signal.aborted) throw new Error('Generation cancelled')

          if (aceResult.status === 'rejected') {
            throw new Error(aceResult.reason?.message || 'ACE-Step submission failed')
          }
          const taskId = aceResult.value
          await updateAceTask({ id: songId as any, aceTaskId: taskId })

          // Poll for audio completion
          currentStep = 'generating_audio'
          await updateStatus({ id: songId as any, status: 'generating_audio' })

          let attempts = 0
          const maxAttempts = 120
          while (attempts < maxAttempts) {
            if (signal.aborted) throw new Error('Generation cancelled')
            await new Promise((resolve) => setTimeout(resolve, 5000))
            if (signal.aborted) throw new Error('Generation cancelled')

            const pollResponse = await fetch('/api/autoplayer/poll-ace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId }),
              signal,
            })
            if (!pollResponse.ok) { attempts++; continue }

            const pollData = await pollResponse.json()
            if (pollData.status === 'succeeded') {
              audioPath = pollData.audioPath
              break
            } else if (pollData.status === 'failed') {
              throw new Error(pollData.error || 'Audio generation failed')
            }
            attempts++
          }

          if (!audioPath) throw new Error('Audio generation timed out')
        }

        if (signal.aborted) throw new Error('Generation cancelled')

        // Save to NFS
        currentStep = 'saving'
        await updateStatus({ id: songId as any, status: 'saving' })
        try {
          const saveResponse = await fetch('/api/autoplayer/save-song', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              songId,
              title: data.title,
              artistName: data.artistName,
              genre: data.genre,
              subGenre: data.subGenre,
              lyrics: data.lyrics,
              caption: data.caption,
              coverPrompt: data.coverPrompt,
              bpm: data.bpm,
              keyScale: data.keyScale,
              timeSignature: data.timeSignature,
              audioDuration: data.audioDuration,
              aceAudioPath: audioPath,
              coverBase64,
            }),
            signal,
          })
          if (saveResponse.ok) {
            const saveData = await saveResponse.json()
            await updateStoragePath({
              id: songId as any,
              storagePath: saveData.storagePath,
              aceAudioPath: audioPath!,
            })
          }
        } catch (e: any) {
          if (signal.aborted) throw new Error('Generation cancelled')
          console.error('NFS save failed during resume, continuing with ACE-Step proxy')
        }

        if (signal.aborted) throw new Error('Generation cancelled')

        // Mark ready
        const encodedAudioPath = encodeURIComponent(audioPath!)
        const audioUrl = `/api/autoplayer/audio/${songId}?aceAudioPath=${encodedAudioPath}`
        await markReady({ id: songId as any, audioUrl })
        await incrementSongs({ id: sessionId as any })
      } catch (error: any) {
        if (signal.aborted) {
          console.log('Resume cancelled')
        } else {
          console.error('Resume pipeline error:', error)
        }
        await markError({
          id: songId as any,
          errorMessage: signal.aborted ? 'Cancelled by user' : (error.message || 'Resume failed'),
          erroredAtStatus: currentStep,
        })
      } finally {
        activeGenerations.current.delete(genKey)
        if (abortControllerRef.current === ac) {
          abortControllerRef.current = null
        }
      }
    },
    [updateStatus, updateAceTask, updateCover, updateStoragePath, markReady, markError, markResuming, incrementSongs],
  )

  return { generate, resumeSong, abort, activeGenerations }
}
