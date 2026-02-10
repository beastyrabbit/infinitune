import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { generateCover } from '../../src/services/cover'

interface SongNeedingCover {
  _id: string
  coverPrompt?: string
}

export async function processCover(
  convex: ConvexHttpClient,
  songs: SongNeedingCover[],
  imageProvider: string | undefined,
  imageModel: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (songs.length === 0 || !imageProvider) return

  const song = songs[0]
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
          id: song._id as any,
          coverStorageId: storageId,
        })
        console.log(`  [cover] Uploaded cover for ${song._id}`)
        return
      }
    } catch {
      // Fall back to data URL
    }

    await convex.mutation(api.songs.updateCover, {
      id: song._id as any,
      coverUrl: `data:image/png;base64,${result.imageBase64}`,
    })
    console.log(`  [cover] Saved cover as data URL for ${song._id}`)
  } catch (error: any) {
    if (signal.aborted) return
    console.error(`  [cover] Error for ${song._id}:`, error.message)
    // Cover is best-effort, don't mark song as error
  }
}
