import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'

export async function processQueueKeeper(
  convex: ConvexHttpClient,
  sessionId: string,
  bufferDeficit: number,
  maxOrderIndex: number,
) {
  if (bufferDeficit <= 0) return

  // Create at most 1 song per tick to prevent burst creation
  const orderIndex = Math.ceil(maxOrderIndex) + 1
  await convex.mutation(api.songs.createPending, {
    sessionId: sessionId as any,
    orderIndex,
  })
  console.log(`  [queue-keeper] Created pending song at order ${orderIndex} (deficit: ${bufferDeficit})`)
}
