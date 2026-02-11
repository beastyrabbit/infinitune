import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
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

type MetadataReadySong = Pick<Doc<"songs">,
  "_id" | "title" | "artistName" | "genre" | "subGenre" | "lyrics" | "caption" |
  "vocalStyle" | "coverPrompt" | "mood" | "energy" | "era" | "instruments" |
  "tags" | "themes" | "language" | "bpm" | "keyScale" | "timeSignature" |
  "audioDuration" | "aceTaskId"
>

type GeneratingAudioSong = Pick<Doc<"songs">,
  "_id" | "aceTaskId" | "aceSubmittedAt" | "title" | "artistName" | "genre" |
  "subGenre" | "lyrics" | "caption" | "vocalStyle" | "coverPrompt" | "mood" |
  "energy" | "era" | "instruments" | "tags" | "themes" | "language" |
  "bpm" | "keyScale" | "timeSignature" | "audioDuration"
>

type PlaylistInfo = Pick<Doc<"playlists">,
  "_id" | "inferenceSteps" | "lyricsLanguage" | "lmTemperature" | "lmCfgScale" | "inferMethod"
> & { aceModel?: string }

// Track active polls so we don't double-poll
const activePolls = new Set<string>()

export async function processAudioSubmit(
  convex: ConvexHttpClient,
  playlist: PlaylistInfo,
  metadataReadySongs: MetadataReadySong[],
  signal: AbortSignal,
): Promise<void> {
  if (metadataReadySongs.length === 0) return

  const song = metadataReadySongs[0]
  const claimed = await convex.mutation(api.songs.claimForAudio, {
    id: song._id,
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
      aceModel: playlist.aceModel,
      inferenceSteps: playlist.inferenceSteps,
      vocalLanguage: mapLanguageToCode(playlist.lyricsLanguage),
      lmTemperature: playlist.lmTemperature,
      lmCfgScale: playlist.lmCfgScale,
      inferMethod: playlist.inferMethod,
      signal,
    })

    if (signal.aborted) return

    await convex.mutation(api.songs.updateAceTask, {
      id: song._id,
      aceTaskId: result.taskId,
    })

    console.log(`  [audio] ACE task ${result.taskId} for "${song.title}"`)
  } catch (error: unknown) {
    if (signal.aborted) return
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`  [audio] Submit error for ${song._id}:`, msg)
    await convex.mutation(api.songs.markError, {
      id: song._id,
      errorMessage: msg || 'ACE-Step submission failed',
      erroredAtStatus: 'submitting_to_ace',
    })
  }
}

export async function processAudioPoll(
  convex: ConvexHttpClient,
  playlistId: Id<"playlists">,
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
        id: song._id,
      })
      continue
    }

    activePolls.add(song._id)

    // Fire off poll in background
    pollSongAudio(convex, playlistId, song, signal).finally(() => {
      activePolls.delete(song._id)
    })
  }
}

async function pollSongAudio(
  convex: ConvexHttpClient,
  playlistId: Id<"playlists">,
  song: GeneratingAudioSong,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await pollAce(song.aceTaskId!, signal)

    if (signal.aborted) return

    if (result.status === 'succeeded' && result.audioPath) {
      console.log(`  [audio] ACE completed for "${song.title}", saving...`)

      await convex.mutation(api.songs.updateStatus, {
        id: song._id,
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
          id: song._id,
          storagePath: saveResult.storagePath,
          aceAudioPath: result.audioPath,
        })
      } catch (e: unknown) {
        console.error(`  [audio] NFS save failed for ${song._id}, continuing:`, e instanceof Error ? e.message : e)
      }

      if (signal.aborted) return

      const encodedAudioPath = encodeURIComponent(result.audioPath)
      const audioUrl = `/api/autoplayer/audio/${song._id}?aceAudioPath=${encodedAudioPath}`
      await convex.mutation(api.songs.markReady, {
        id: song._id,
        audioUrl,
      })
      await convex.mutation(api.playlists.incrementSongsGenerated, {
        id: playlistId,
      })

      console.log(`  [audio] Song "${song.title}" is READY`)
    } else if (result.status === 'failed') {
      console.error(`  [audio] ACE failed for ${song._id}: ${result.error}`)
      await convex.mutation(api.songs.markError, {
        id: song._id,
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
          id: song._id,
        })
      }
    }
    // 'running' → do nothing, will be polled again next cycle
  } catch (error: unknown) {
    if (signal.aborted) return
    console.error(`  [audio] Poll error for ${song._id}:`, error instanceof Error ? error.message : error)
    // Don't mark error on poll failure — could be transient network issue
  }
}
