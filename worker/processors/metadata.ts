import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { generateSongMetadata } from '../../src/services/llm'

interface PendingSong {
  _id: string
  interruptPrompt?: string
}

interface Session {
  _id: string
  prompt: string
  llmProvider: string
  llmModel: string
  lyricsLanguage?: string
  targetBpm?: number
  targetKey?: string
  timeSignature?: string
  audioDuration?: number
}

export async function processMetadata(
  convex: ConvexHttpClient,
  session: Session,
  pendingSongs: PendingSong[],
  signal: AbortSignal,
): Promise<void> {
  if (pendingSongs.length === 0) return

  const song = pendingSongs[0]
  const claimed = await convex.mutation(api.songs.claimForMetadata, {
    id: song._id as any,
  })
  if (!claimed) return

  console.log(`  [metadata] Processing song ${song._id}`)

  try {
    const prompt = song.interruptPrompt || session.prompt
    const metadata = await generateSongMetadata({
      prompt,
      provider: session.llmProvider,
      model: session.llmModel,
      lyricsLanguage: session.lyricsLanguage,
      targetBpm: session.targetBpm,
      targetKey: session.targetKey,
      timeSignature: session.timeSignature,
      audioDuration: session.audioDuration,
      signal,
    })

    if (signal.aborted) return

    await convex.mutation(api.songs.completeMetadata, {
      id: song._id as any,
      title: metadata.title,
      artistName: metadata.artistName,
      genre: metadata.genre,
      subGenre: metadata.subGenre || metadata.genre,
      lyrics: metadata.lyrics,
      caption: metadata.caption,
      coverPrompt: metadata.coverPrompt,
      bpm: metadata.bpm,
      keyScale: metadata.keyScale,
      timeSignature: metadata.timeSignature,
      audioDuration: metadata.audioDuration,
    })

    console.log(`  [metadata] Completed: "${metadata.title}" by ${metadata.artistName}`)
  } catch (error: any) {
    if (signal.aborted) return
    console.error(`  [metadata] Error for ${song._id}:`, error.message)
    await convex.mutation(api.songs.markError, {
      id: song._id as any,
      errorMessage: error.message || 'Metadata generation failed',
      erroredAtStatus: 'generating_metadata',
    })
  }
}
