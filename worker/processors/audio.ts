import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { submitToAce, pollAce } from '../../src/services/ace'
import { saveSongToNfs } from '../../src/services/storage'

const LANGUAGE_MAP: Record<string, string> = {
  english: 'en', german: 'de', spanish: 'es', french: 'fr',
  korean: 'ko', japanese: 'ja', russian: 'ru', chinese: 'zh',
}

function mapLanguageToCode(language?: string): string | undefined {
  if (!language || language === 'auto') return undefined
  return LANGUAGE_MAP[language.toLowerCase()] || language
}

// Grace period before treating "not_found" as a lost task (2 minutes)
const NOT_FOUND_GRACE_MS = 2 * 60 * 1000

interface MetadataReadySong {
  _id: string
  title?: string
  artistName?: string
  genre?: string
  subGenre?: string
  lyrics?: string
  caption?: string
  vocalStyle?: string
  coverPrompt?: string
  mood?: string
  energy?: string
  era?: string
  instruments?: string[]
  tags?: string[]
  themes?: string[]
  language?: string
  bpm?: number
  keyScale?: string
  timeSignature?: string
  audioDuration?: number
  aceTaskId?: string
}

interface GeneratingAudioSong {
  _id: string
  aceTaskId?: string
  aceSubmittedAt?: number
  title?: string
  artistName?: string
  genre?: string
  subGenre?: string
  lyrics?: string
  caption?: string
  vocalStyle?: string
  coverPrompt?: string
  mood?: string
  energy?: string
  era?: string
  instruments?: string[]
  tags?: string[]
  themes?: string[]
  language?: string
  bpm?: number
  keyScale?: string
  timeSignature?: string
  audioDuration?: number
}

interface SessionInfo {
  _id: string
  aceModel?: string
  inferenceSteps?: number
  lyricsLanguage?: string
  lmTemperature?: number
  lmCfgScale?: number
  inferMethod?: string
}

// Track active polls so we don't double-poll
const activePolls = new Set<string>()

export async function processAudioSubmit(
  convex: ConvexHttpClient,
  session: SessionInfo,
  metadataReadySongs: MetadataReadySong[],
  signal: AbortSignal,
): Promise<void> {
  if (metadataReadySongs.length === 0) return

  const song = metadataReadySongs[0]
  const claimed = await convex.mutation(api.songs.claimForAudio, {
    id: song._id as any,
  })
  if (!claimed) return

  console.log(`  [audio] Submitting "${song.title}" to ACE-Step`)

  try {
    const result = await submitToAce({
      lyrics: song.lyrics || '',
      caption: song.caption || '',
      vocalStyle: song.vocalStyle,
      bpm: song.bpm || 120,
      keyScale: song.keyScale || 'C major',
      timeSignature: song.timeSignature || '4/4',
      audioDuration: song.audioDuration || 240,
      aceModel: session.aceModel,
      inferenceSteps: session.inferenceSteps,
      vocalLanguage: mapLanguageToCode(session.lyricsLanguage),
      lmTemperature: session.lmTemperature,
      lmCfgScale: session.lmCfgScale,
      inferMethod: session.inferMethod,
      signal,
    })

    if (signal.aborted) return

    await convex.mutation(api.songs.updateAceTask, {
      id: song._id as any,
      aceTaskId: result.taskId,
    })

    console.log(`  [audio] ACE task ${result.taskId} for "${song.title}"`)
  } catch (error: any) {
    if (signal.aborted) return
    console.error(`  [audio] Submit error for ${song._id}:`, error.message)
    await convex.mutation(api.songs.markError, {
      id: song._id as any,
      errorMessage: error.message || 'ACE-Step submission failed',
      erroredAtStatus: 'submitting_to_ace',
    })
  }
}

export async function processAudioPoll(
  convex: ConvexHttpClient,
  sessionId: string,
  generatingAudioSongs: GeneratingAudioSong[],
  signal: AbortSignal,
): Promise<void> {
  for (const song of generatingAudioSongs) {
    if (activePolls.has(song._id) || signal.aborted) continue

    // No aceTaskId means this song was recovered from a restart (saving → generating_audio)
    // but the aceTaskId was somehow lost. Revert to metadata_ready to re-submit.
    if (!song.aceTaskId) {
      console.log(`  [audio] Song ${song._id} has no aceTaskId, reverting to metadata_ready`)
      await convex.mutation(api.songs.revertToMetadataReady, {
        id: song._id as any,
      })
      continue
    }

    activePolls.add(song._id)

    // Fire off poll in background
    pollSongAudio(convex, sessionId, song, signal).finally(() => {
      activePolls.delete(song._id)
    })
  }
}

async function pollSongAudio(
  convex: ConvexHttpClient,
  sessionId: string,
  song: GeneratingAudioSong,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await pollAce(song.aceTaskId!, signal)

    if (signal.aborted) return

    if (result.status === 'succeeded' && result.audioPath) {
      console.log(`  [audio] ACE completed for "${song.title}", saving...`)

      await convex.mutation(api.songs.updateStatus, {
        id: song._id as any,
        status: 'saving',
      })

      // Save to NFS
      try {
        const saveResult = await saveSongToNfs({
          songId: song._id,
          title: song.title || 'Unknown',
          artistName: song.artistName || 'Unknown',
          genre: song.genre || 'Unknown',
          subGenre: song.subGenre || song.genre || 'Unknown',
          lyrics: song.lyrics || '',
          caption: song.caption || '',
          vocalStyle: song.vocalStyle,
          coverPrompt: song.coverPrompt,
          mood: song.mood,
          energy: song.energy,
          era: song.era,
          instruments: song.instruments,
          tags: song.tags,
          themes: song.themes,
          language: song.language,
          bpm: song.bpm || 120,
          keyScale: song.keyScale || 'C major',
          timeSignature: song.timeSignature || '4/4',
          audioDuration: song.audioDuration || 240,
          aceAudioPath: result.audioPath,
        })
        await convex.mutation(api.songs.updateStoragePath, {
          id: song._id as any,
          storagePath: saveResult.storagePath,
          aceAudioPath: result.audioPath,
        })
      } catch (e: any) {
        console.error(`  [audio] NFS save failed for ${song._id}, continuing:`, e.message)
      }

      if (signal.aborted) return

      const encodedAudioPath = encodeURIComponent(result.audioPath)
      const audioUrl = `/api/autoplayer/audio/${song._id}?aceAudioPath=${encodedAudioPath}`
      await convex.mutation(api.songs.markReady, {
        id: song._id as any,
        audioUrl,
      })
      await convex.mutation(api.sessions.incrementSongsGenerated, {
        id: sessionId as any,
      })

      console.log(`  [audio] Song "${song.title}" is READY`)
    } else if (result.status === 'failed') {
      console.error(`  [audio] ACE failed for ${song._id}: ${result.error}`)
      await convex.mutation(api.songs.markError, {
        id: song._id as any,
        errorMessage: result.error || 'Audio generation failed',
        erroredAtStatus: 'generating_audio',
      })
    } else if (result.status === 'not_found') {
      // ACE doesn't know about this task — possibly ACE was restarted
      const submittedAt = song.aceSubmittedAt || 0
      const elapsed = Date.now() - submittedAt

      if (elapsed < NOT_FOUND_GRACE_MS) {
        // Recently submitted, ACE might still be registering the task
        console.log(`  [audio] ACE task ${song.aceTaskId} not found yet for "${song.title}" (${Math.round(elapsed / 1000)}s ago), waiting...`)
      } else {
        // Past grace period, task is truly lost — revert to re-submit
        console.log(`  [audio] ACE task ${song.aceTaskId} lost for "${song.title}", reverting to metadata_ready for re-submission`)
        await convex.mutation(api.songs.revertToMetadataReady, {
          id: song._id as any,
        })
      }
    }
    // 'running' → do nothing, will be polled again next cycle
  } catch (error: any) {
    if (signal.aborted) return
    console.error(`  [audio] Poll error for ${song._id}:`, error.message)
    // Don't mark error on poll failure — could be transient network issue
  }
}
