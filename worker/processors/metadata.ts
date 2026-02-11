import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import type { LlmProvider } from '../../convex/types'
import { generateSongMetadata, type PromptDistance, type RecentSong, type SongMetadata } from '../../src/services/llm'

type PendingSong = Pick<Doc<"songs">, "_id" | "interruptPrompt">
type Session = Pick<Doc<"sessions">, "_id" | "prompt" | "llmProvider" | "llmModel" | "lyricsLanguage" | "targetBpm" | "targetKey" | "timeSignature" | "audioDuration" | "mode">

/** Check if the generated title is too similar to any recent song */
function isDuplicate(metadata: SongMetadata, recentSongs: RecentSong[]): boolean {
  const newTitle = metadata.title.toLowerCase().trim()
  const newArtist = metadata.artistName.toLowerCase().trim()
  return recentSongs.some((s) => {
    const existingTitle = s.title.toLowerCase().trim()
    const existingArtist = s.artistName.toLowerCase().trim()
    return existingTitle === newTitle || existingArtist === newArtist
  })
}

async function processOneSong(
  convex: ConvexHttpClient,
  session: Session,
  song: PendingSong,
  recentSongs: RecentSong[],
  recentDescriptions: string[],
  signal: AbortSignal,
): Promise<void> {
  const claimed = await convex.mutation(api.songs.claimForMetadata, {
    id: song._id,
  })
  if (!claimed) return

  console.log(`  [metadata] Processing song ${song._id}`)

  try {
    // Query live settings — allows switching provider without restarting session
    const textProvider = await convex.query(api.settings.get, { key: 'textProvider' })
    const textModel = await convex.query(api.settings.get, { key: 'textModel' })
    const effectiveProvider = (textProvider as LlmProvider) || session.llmProvider
    const effectiveModel = textModel || session.llmModel

    console.log(`  [metadata] Using LLM: ${effectiveProvider} / ${effectiveModel}`)

    const prompt = song.interruptPrompt || session.prompt
    const isInterrupt = !!song.interruptPrompt

    // Pick prompt distance: faithful for interrupts and oneshot, random close/general for infinite gen
    let promptDistance: PromptDistance = 'faithful'
    if (!isInterrupt && session.mode !== 'oneshot') {
      promptDistance = Math.random() < 0.6 ? 'close' : 'general'
      console.log(`  [metadata] Prompt distance: ${promptDistance}`)
    }

    const genOptions = {
      prompt,
      provider: effectiveProvider,
      model: effectiveModel,
      lyricsLanguage: session.lyricsLanguage,
      targetBpm: session.targetBpm,
      targetKey: session.targetKey,
      timeSignature: session.timeSignature,
      audioDuration: session.audioDuration,
      recentSongs,
      recentDescriptions,
      isInterrupt,
      promptDistance,
      signal,
    }

    let metadata = await generateSongMetadata(genOptions)

    // Hard dedup: if title or artist matches a recent song, retry once
    if (isDuplicate(metadata, recentSongs)) {
      console.log(`  [metadata] Duplicate detected: "${metadata.title}" by ${metadata.artistName} — retrying`)
      metadata = await generateSongMetadata(genOptions)

      if (isDuplicate(metadata, recentSongs)) {
        console.log(`  [metadata] Still duplicate after retry: "${metadata.title}" — accepting anyway`)
      }
    }

    if (signal.aborted) return

    await convex.mutation(api.songs.completeMetadata, {
      id: song._id,
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
    })

    console.log(`  [metadata] Completed: "${metadata.title}" by ${metadata.artistName}`)
  } catch (error: unknown) {
    if (signal.aborted) return
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`  [metadata] Error for ${song._id}:`, msg)
    await convex.mutation(api.songs.markError, {
      id: song._id,
      errorMessage: msg || 'Metadata generation failed',
      erroredAtStatus: 'generating_metadata',
    })
  }
}

export async function processMetadata(
  convex: ConvexHttpClient,
  session: Session,
  pendingSongs: PendingSong[],
  recentSongs: RecentSong[],
  recentDescriptions: string[],
  signal: AbortSignal,
  concurrent = false,
): Promise<void> {
  if (pendingSongs.length === 0) return

  if (concurrent) {
    // Fire all pending songs concurrently (safe for remote providers like openrouter)
    await Promise.all(
      pendingSongs.map((song) =>
        processOneSong(convex, session, song, recentSongs, recentDescriptions, signal)
      ),
    )
  } else {
    // Process one at a time (for local providers like ollama)
    await processOneSong(convex, session, pendingSongs[0], recentSongs, recentDescriptions, signal)
  }
}
