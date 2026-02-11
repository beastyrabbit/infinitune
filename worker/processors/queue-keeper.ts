import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

export async function processQueueKeeper(
  convex: ConvexHttpClient,
  playlistId: Id<"playlists">,
  bufferDeficit: number,
  maxOrderIndex: number,
) {
  if (bufferDeficit <= 0) return

  // Create at most 1 song per tick to prevent burst creation
  const orderIndex = Math.ceil(maxOrderIndex) + 1
  await convex.mutation(api.songs.createPending, {
    playlistId,
    orderIndex,
  })
  console.log(`  [queue-keeper] Created pending song at order ${orderIndex} (deficit: ${bufferDeficit})`)
}
