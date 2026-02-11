import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Doc } from '../../convex/_generated/dataModel'
import { generateCover } from '../../src/services/cover'

type SongNeedingCover = Pick<Doc<"songs">, "_id" | "coverPrompt">

async function processOneCover(
  convex: ConvexHttpClient,
  song: SongNeedingCover,
  imageProvider: string,
  imageModel: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (!song.coverPrompt) return

  console.log(`  [cover] Generating cover for ${song._id}`)

  try {
    const result = await generateCover({
      coverPrompt: song.coverPrompt,
      provider: imageProvider,
      model: imageModel,
      signal,
    })

    if (signal.aborted || !result) return

    // Upload to Convex storage
    try {
      const uploadUrl = await convex.mutation(api.songs.generateUploadUrl)
      const blob = new Blob(
        [Uint8Array.from(atob(result.imageBase64), (c) => c.charCodeAt(0))],
        { type: 'image/png' },
      )
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      })
      if (uploadRes.ok) {
        const { storageId } = await uploadRes.json()
        await convex.mutation(api.songs.updateCoverStorage, {
          id: song._id,
          coverStorageId: storageId,
        })
        console.log(`  [cover] Uploaded cover for ${song._id}`)
        return
      }
    } catch {
      // Fall back to data URL
    }

    await convex.mutation(api.songs.updateCover, {
      id: song._id,
      coverUrl: `data:image/png;base64,${result.imageBase64}`,
    })
    console.log(`  [cover] Saved cover as data URL for ${song._id}`)
  } catch (error: unknown) {
    if (signal.aborted) return
    console.error(`  [cover] Error for ${song._id}:`, error instanceof Error ? error.message : error)
    // Cover is best-effort, don't mark song as error
  }
}

export async function processCover(
  convex: ConvexHttpClient,
  songs: SongNeedingCover[],
  imageProvider: string | undefined,
  imageModel: string | undefined,
  signal: AbortSignal,
  concurrent = false,
): Promise<void> {
  if (songs.length === 0 || !imageProvider) return

  if (concurrent) {
    // Fire all covers concurrently (safe for comfyui which has its own queue)
    await Promise.all(
      songs.map((song) => processOneCover(convex, song, imageProvider, imageModel, signal)),
    )
  } else {
    // Process one at a time (for providers without internal queuing)
    await processOneCover(convex, songs[0], imageProvider, imageModel, signal)
  }
}
