import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'
import type { LlmProvider } from '../convex/types'
import { generateSongMetadata, type PromptDistance, type RecentSong, type SongMetadata } from '../src/services/llm'
import { submitToAce } from '../src/services/ace'
import { generateCover } from '../src/services/cover'
import { saveSongToNfs } from '../src/services/storage'
import type { EndpointQueues } from './queues'
import { calculatePriority } from './priority'

// ─── Types ───────────────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
  english: 'en', german: 'de', spanish: 'es', french: 'fr',
  korean: 'ko', japanese: 'ja', russian: 'ru', chinese: 'zh',
}

function mapLanguageToCode(language?: string): string | undefined {
  if (!language || language === 'auto') return undefined
  return LANGUAGE_MAP[language.toLowerCase()] || language
}

type SongDoc = Doc<"songs">
type PlaylistDoc = Doc<"playlists">

export type SongWorkerStatus = 'running' | 'completed' | 'errored' | 'cancelled'

interface SongWorkerContext {
  convex: ConvexHttpClient
  queues: EndpointQueues
  playlist: PlaylistDoc
  recentSongs: RecentSong[]
  recentDescriptions: string[]
  getPlaylistActive: () => Promise<boolean>
  getCurrentEpoch?: () => number
  getSettings: () => Promise<{ textProvider: string; textModel: string; imageProvider: string; imageModel?: string }>
}

// ─── Duplicate Detection ─────────────────────────────────────────────

function isDuplicate(metadata: SongMetadata, recentSongs: RecentSong[]): boolean {
  const newTitle = metadata.title.toLowerCase().trim()
  const newArtist = metadata.artistName.toLowerCase().trim()
  return recentSongs.some((s) => {
    const existingTitle = s.title.toLowerCase().trim()
    const existingArtist = s.artistName.toLowerCase().trim()
    return existingTitle === newTitle || existingArtist === newArtist
  })
}

// ─── SongWorker ──────────────────────────────────────────────────────

export class SongWorker {
  readonly songId: Id<"songs">
  private song: SongDoc
  private ctx: SongWorkerContext
  private aborted = false
  private _status: SongWorkerStatus = 'running'

  get status(): SongWorkerStatus {
    return this._status
  }

  constructor(song: SongDoc, ctx: SongWorkerContext) {
    this.songId = song._id
    this.song = song
    this.ctx = ctx
  }

  /** Get the live current epoch, falling back to the snapshot if callback not provided */
  private getCurrentEpoch(): number {
    return this.ctx.getCurrentEpoch?.() ?? this.ctx.playlist.promptEpoch ?? 0
  }

  /** Fire-and-forget entry point. Returns when song is ready/errored/cancelled. */
  async run(): Promise<void> {
    try {
      const initialStatus = this.song.status

      // Determine starting point based on current status (recovery)
      switch (initialStatus) {
        case 'pending':
          await this.generateMetadata()
          if (this.aborted) return
          this.startCover() // fire-and-forget
          await this.submitAndPollAudio()
          break

        case 'generating_metadata':
          // LLM work was lost (worker restart), revert and redo
          await this.ctx.convex.mutation(api.songs.revertSingleSong, { id: this.songId })
          await this.generateMetadata()
          if (this.aborted) return
          this.startCover()
          await this.submitAndPollAudio()
          break

        case 'metadata_ready':
          // Skip metadata, start from cover+audio
          this.startCover()
          await this.submitAndPollAudio()
          break

        case 'submitting_to_ace':
          // ACE submission lost, revert and redo audio
          await this.ctx.convex.mutation(api.songs.revertSingleSong, { id: this.songId })
          this.startCover()
          await this.submitAndPollAudio()
          break

        case 'generating_audio':
          // Resume polling with existing aceTaskId
          if (this.song.aceTaskId) {
            await this.resumeAudioPoll()
          } else {
            // No taskId — revert and re-submit
            await this.ctx.convex.mutation(api.songs.revertToMetadataReady, { id: this.songId })
            await this.submitAndPollAudio()
          }
          break

        case 'saving':
          // Audio exists on ACE, re-poll to re-trigger save
          await this.ctx.convex.mutation(api.songs.updateStatus, {
            id: this.songId,
            status: 'generating_audio',
          })
          if (this.song.aceTaskId) {
            await this.resumeAudioPoll()
          } else {
            await this.ctx.convex.mutation(api.songs.revertToMetadataReady, { id: this.songId })
            await this.submitAndPollAudio()
          }
          break

        default:
          // Song is in a terminal or non-actionable state
          this._status = 'completed'
          return
      }

      this._status = 'completed'
    } catch (error: unknown) {
      if (this.aborted) {
        this._status = 'cancelled'
        return
      }
      this._status = 'errored'
      console.error(`[song-worker] Song ${this.songId} failed:`, error instanceof Error ? error.message : error)
    }
  }

  cancel(): void {
    this.aborted = true
    this.ctx.queues.cancelAllForSong(this.songId)
  }

  // ─── Pipeline Steps ──────────────────────────────────────────────

  private async generateMetadata(): Promise<void> {
    if (this.aborted) return

    const claimed = await this.ctx.convex.mutation(api.songs.claimForMetadata, {
      id: this.songId,
    })
    if (!claimed) return

    console.log(`  [song-worker] Generating metadata for ${this.songId}`)

    const settings = await this.ctx.getSettings()
    const effectiveProvider = (settings.textProvider as LlmProvider) || this.ctx.playlist.llmProvider
    const effectiveModel = settings.textModel || this.ctx.playlist.llmModel

    const prompt = this.song.interruptPrompt || this.ctx.playlist.prompt
    const isInterrupt = !!this.song.interruptPrompt
    const isOneshot = this.ctx.playlist.mode === 'oneshot'

    let promptDistance: PromptDistance = 'faithful'
    if (!isInterrupt && !isOneshot) {
      promptDistance = Math.random() < 0.6 ? 'close' : 'general'
    }

    const priority = calculatePriority({
      isOneshot,
      isInterrupt,
      orderIndex: this.song.orderIndex,
      currentOrderIndex: this.ctx.playlist.currentOrderIndex ?? 0,
      isClosing: this.ctx.playlist.status === 'closing',
      currentEpoch: this.getCurrentEpoch(),
      songEpoch: this.song.promptEpoch ?? 0,
    })

    try {
      const { result, processingMs } = await this.ctx.queues.llm.enqueue({
        songId: this.songId,
        priority,
        endpoint: effectiveProvider,
        execute: async (signal) => {
          const genOptions = {
            prompt,
            provider: effectiveProvider,
            model: effectiveModel,
            lyricsLanguage: this.ctx.playlist.lyricsLanguage,
            targetBpm: this.ctx.playlist.targetBpm,
            targetKey: this.ctx.playlist.targetKey,
            timeSignature: this.ctx.playlist.timeSignature,
            audioDuration: this.ctx.playlist.audioDuration,
            recentSongs: this.ctx.recentSongs,
            recentDescriptions: this.ctx.recentDescriptions,
            isInterrupt,
            promptDistance,
            signal,
          }

          let result = await generateSongMetadata(genOptions)

          // Hard dedup: if title or artist matches a recent song, retry once
          if (isDuplicate(result, this.ctx.recentSongs)) {
            console.log(`  [song-worker] Duplicate detected: "${result.title}" — retrying`)
            result = await generateSongMetadata(genOptions)
            if (isDuplicate(result, this.ctx.recentSongs)) {
              console.log(`  [song-worker] Still duplicate after retry: "${result.title}" — accepting anyway`)
            }
          }

          return result
        },
      })

      const metadata = result as SongMetadata

      if (this.aborted) return

      await this.ctx.convex.mutation(api.songs.completeMetadata, {
        id: this.songId,
        title: metadata.title,
        artistName: metadata.artistName,
        genre: metadata.genre,
        subGenre: metadata.subGenre || metadata.genre,
        lyrics: metadata.lyrics,
        caption: metadata.caption,
        vocalStyle: metadata.vocalStyle,
        coverPrompt: metadata.coverPrompt,
        bpm: metadata.bpm,
        keyScale: metadata.keyScale,
        timeSignature: metadata.timeSignature,
        audioDuration: metadata.audioDuration,
        mood: metadata.mood,
        energy: metadata.energy,
        era: metadata.era,
        instruments: metadata.instruments,
        tags: metadata.tags,
        themes: metadata.themes,
        language: metadata.language,
        description: metadata.description,
        llmProvider: effectiveProvider,
        llmModel: effectiveModel,
        metadataProcessingMs: processingMs,
      })

      // Update local song state
      this.song = { ...this.song, ...metadata, status: 'metadata_ready' } as SongDoc

      console.log(`  [song-worker] Metadata complete: "${metadata.title}" by ${metadata.artistName} (${processingMs}ms)`)
    } catch (error: unknown) {
      if (this.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      if (msg === 'Cancelled') return
      console.error(`  [song-worker] Metadata error for ${this.songId}:`, msg)
      await this.ctx.convex.mutation(api.songs.markError, {
        id: this.songId,
        errorMessage: msg || 'Metadata generation failed',
        erroredAtStatus: 'generating_metadata',
      })
      throw error
    }
  }

  /** Fire-and-forget cover generation — best-effort, doesn't fail the song */
  private startCover(): void {
    if (this.aborted) return
    if (!this.song.coverPrompt) return
    if (this.song.coverUrl) return // Already has cover art

    const songId = this.songId
    const coverPrompt = this.song.coverPrompt

    const isOneshot = this.ctx.playlist.mode === 'oneshot'
    const isInterrupt = !!this.song.interruptPrompt
    const priority = calculatePriority({
      isOneshot,
      isInterrupt,
      orderIndex: this.song.orderIndex,
      currentOrderIndex: this.ctx.playlist.currentOrderIndex ?? 0,
      isClosing: this.ctx.playlist.status === 'closing',
      currentEpoch: this.getCurrentEpoch(),
      songEpoch: this.song.promptEpoch ?? 0,
    })

    // Fire-and-forget — we don't await this
    this.ctx.getSettings().then((settings) => {
      const imageProvider = settings.imageProvider === 'ollama' ? 'comfyui' : settings.imageProvider
      const imageModel = settings.imageModel

      return this.ctx.queues.image.enqueue({
        songId,
        priority,
        endpoint: imageProvider,
        execute: async (signal) => {
          const result = await generateCover({
            coverPrompt,
            provider: imageProvider,
            model: imageModel,
            signal,
          })
          if (!result) throw new Error('No cover generated')
          return { imageBase64: result.imageBase64 }
        },
      })
    }).then(async ({ result: coverResult, processingMs }) => {
      // Upload to Convex storage
      try {
        const uploadUrl = await this.ctx.convex.mutation(api.songs.generateUploadUrl)
        const blob = new Blob(
          [Uint8Array.from(atob(coverResult.imageBase64), (c) => c.charCodeAt(0))],
          { type: 'image/png' },
        )
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: blob,
        })
        if (uploadRes.ok) {
          const { storageId } = await uploadRes.json()
          await this.ctx.convex.mutation(api.songs.updateCoverStorage, {
            id: songId,
            coverStorageId: storageId,
          })
          console.log(`  [song-worker] Cover uploaded for ${songId} (${processingMs}ms)`)
          await this.ctx.convex.mutation(api.songs.updateCoverProcessingMs, {
            id: songId,
            coverProcessingMs: processingMs,
          })
          return
        }
      } catch {
        // Fall back to data URL
      }

      await this.ctx.convex.mutation(api.songs.updateCover, {
        id: songId,
        coverUrl: `data:image/png;base64,${coverResult.imageBase64}`,
      })
      await this.ctx.convex.mutation(api.songs.updateCoverProcessingMs, {
        id: songId,
        coverProcessingMs: processingMs,
      })
    }).catch((error: unknown) => {
      if (this.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      if (msg === 'Cancelled') return
      console.error(`  [song-worker] Cover error for ${songId}:`, msg)
      // Cover is best-effort, don't fail the song
    })
  }

  private async submitAndPollAudio(): Promise<void> {
    if (this.aborted) return

    // Check playlist still active before audio submission
    const active = await this.ctx.getPlaylistActive()
    if (!active && this.aborted) return

    const claimed = await this.ctx.convex.mutation(api.songs.claimForAudio, {
      id: this.songId,
    })
    if (!claimed) return

    console.log(`  [song-worker] Submitting "${this.song.title}" to ACE-Step`)

    const isOneshot = this.ctx.playlist.mode === 'oneshot'
    const isInterrupt = !!this.song.interruptPrompt
    const priority = calculatePriority({
      isOneshot,
      isInterrupt,
      orderIndex: this.song.orderIndex,
      currentOrderIndex: this.ctx.playlist.currentOrderIndex ?? 0,
      isClosing: this.ctx.playlist.status === 'closing',
      currentEpoch: this.getCurrentEpoch(),
      songEpoch: this.song.promptEpoch ?? 0,
    })

    try {
      const { result: audioResult, processingMs } = await this.ctx.queues.audio.enqueue({
        songId: this.songId,
        priority,
        endpoint: 'ace-step',
        execute: async (signal) => {
          const result = await submitToAce({
            lyrics: this.song.lyrics || '',
            caption: this.song.caption || '',
            vocalStyle: this.song.vocalStyle,
            bpm: this.song.bpm || 120,
            keyScale: this.song.keyScale || 'C major',
            timeSignature: this.song.timeSignature || '4/4',
            audioDuration: this.song.audioDuration || 240,
            aceModel: (this.ctx.playlist as PlaylistDoc & { aceModel?: string }).aceModel,
            inferenceSteps: this.ctx.playlist.inferenceSteps,
            vocalLanguage: mapLanguageToCode(this.ctx.playlist.lyricsLanguage),
            lmTemperature: this.ctx.playlist.lmTemperature,
            lmCfgScale: this.ctx.playlist.lmCfgScale,
            inferMethod: this.ctx.playlist.inferMethod,
            signal,
          })

          if (signal.aborted) throw new Error('Cancelled')

          // Update Convex with taskId
          await this.ctx.convex.mutation(api.songs.updateAceTask, {
            id: this.songId,
            aceTaskId: result.taskId,
          })

          console.log(`  [song-worker] ACE task ${result.taskId} for "${this.song.title}"`)

          return { taskId: result.taskId, status: 'running' as const, submitProcessingMs: 0 }
        },
      })

      if (this.aborted) return

      await this.handleAudioResult(audioResult.taskId, audioResult.status, audioResult, processingMs)
    } catch (error: unknown) {
      if (this.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      if (msg === 'Cancelled') return
      console.error(`  [song-worker] Audio error for ${this.songId}:`, msg)
      await this.ctx.convex.mutation(api.songs.markError, {
        id: this.songId,
        errorMessage: msg || 'Audio generation failed',
        erroredAtStatus: 'submitting_to_ace',
      })
      throw error
    }
  }

  private async resumeAudioPoll(): Promise<void> {
    if (this.aborted || !this.song.aceTaskId) return

    console.log(`  [song-worker] Resuming audio poll for "${this.song.title}" (task ${this.song.aceTaskId})`)

    try {
      const { result: audioResult, processingMs } = await this.ctx.queues.audio.resumePoll(
        this.songId,
        this.song.aceTaskId,
        this.song.aceSubmittedAt || Date.now(),
      )

      if (this.aborted) return

      await this.handleAudioResult(audioResult.taskId, audioResult.status, audioResult, processingMs)
    } catch (error: unknown) {
      if (this.aborted) return
      const msg = error instanceof Error ? error.message : String(error)
      if (msg === 'Cancelled') return
      console.error(`  [song-worker] Audio poll error for ${this.songId}:`, msg)
    }
  }

  private async handleAudioResult(
    taskId: string,
    status: string,
    audioResult: { audioPath?: string; error?: string },
    processingMs: number,
  ): Promise<void> {
    if (status === 'succeeded' && audioResult.audioPath) {
      await this.saveAndFinalize(audioResult.audioPath, processingMs)
    } else if (status === 'failed') {
      console.error(`  [song-worker] ACE failed for ${this.songId}: ${audioResult.error}`)
      await this.ctx.convex.mutation(api.songs.markError, {
        id: this.songId,
        errorMessage: audioResult.error || 'Audio generation failed',
        erroredAtStatus: 'generating_audio',
      })
      throw new Error(audioResult.error || 'Audio generation failed')
    } else if (status === 'not_found') {
      console.log(`  [song-worker] ACE task ${taskId} lost for "${this.song.title}", reverting`)
      await this.ctx.convex.mutation(api.songs.revertToMetadataReady, {
        id: this.songId,
      })
      throw new Error('ACE task not found')
    }
  }

  private async saveAndFinalize(audioPath: string, audioProcessingMs: number): Promise<void> {
    console.log(`  [song-worker] ACE completed for "${this.song.title}", saving...`)

    await this.ctx.convex.mutation(api.songs.updateStatus, {
      id: this.songId,
      status: 'saving',
    })

    // Save to NFS
    try {
      const saveResult = await saveSongToNfs({
        songId: this.songId,
        title: this.song.title || 'Unknown',
        artistName: this.song.artistName || 'Unknown',
        genre: this.song.genre || 'Unknown',
        subGenre: this.song.subGenre || this.song.genre || 'Unknown',
        lyrics: this.song.lyrics || '',
        caption: this.song.caption || '',
        vocalStyle: this.song.vocalStyle,
        coverPrompt: this.song.coverPrompt,
        mood: this.song.mood,
        energy: this.song.energy,
        era: this.song.era,
        instruments: this.song.instruments,
        tags: this.song.tags,
        themes: this.song.themes,
        language: this.song.language,
        bpm: this.song.bpm || 120,
        keyScale: this.song.keyScale || 'C major',
        timeSignature: this.song.timeSignature || '4/4',
        audioDuration: this.song.audioDuration || 240,
        aceAudioPath: audioPath,
      })
      await this.ctx.convex.mutation(api.songs.updateStoragePath, {
        id: this.songId,
        storagePath: saveResult.storagePath,
        aceAudioPath: audioPath,
      })
      // Update duration if silence was trimmed
      if (saveResult.effectiveDuration) {
        await this.ctx.convex.mutation(api.songs.updateAudioDuration, {
          id: this.songId,
          audioDuration: saveResult.effectiveDuration,
        })
      }
    } catch (e: unknown) {
      console.error(`  [song-worker] NFS save failed for ${this.songId}, continuing:`, e instanceof Error ? e.message : e)
    }

    if (this.aborted) return

    const encodedAudioPath = encodeURIComponent(audioPath)
    const audioUrl = `/api/autoplayer/audio/${this.songId}?aceAudioPath=${encodedAudioPath}`
    await this.ctx.convex.mutation(api.songs.markReady, {
      id: this.songId,
      audioUrl,
      audioProcessingMs,
    })
    await this.ctx.convex.mutation(api.playlists.incrementSongsGenerated, {
      id: this.ctx.playlist._id,
    })

    console.log(`  [song-worker] Song "${this.song.title}" is READY (audio: ${audioProcessingMs}ms)`)
  }
}
