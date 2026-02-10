import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'

export async function processQueueKeeper(
  convex: ConvexHttpClient,
  sessionId: string,
  bufferDeficit: number,
  maxOrderIndex: number,
) {
  if (bufferDeficit <= 0) return

  const baseOrder = Math.ceil(maxOrderIndex) + 1

  for (let i = 0; i < bufferDeficit; i++) {
    const orderIndex = baseOrder + i
    await convex.mutation(api.songs.createPending, {
      sessionId: sessionId as any,
      orderIndex,
    })
    console.log(`  [queue-keeper] Created pending song at order ${orderIndex}`)
  }
}
