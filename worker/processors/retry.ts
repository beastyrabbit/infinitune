import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'

interface RetryPendingSong {
  _id: string
  retryCount?: number
}

export async function processRetry(
  convex: ConvexHttpClient,
  retryPendingSongs: RetryPendingSong[],
): Promise<void> {
  for (const song of retryPendingSongs) {
    console.log(`  [retry] Reverting song ${song._id} (retry ${(song.retryCount || 0) + 1}/3)`)
    await convex.mutation(api.songs.retryErroredSong, {
      id: song._id as any,
    })
  }
}
