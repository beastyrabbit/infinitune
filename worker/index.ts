import { getConvexClient } from './convex-client'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { processQueueKeeper } from './processors/queue-keeper'
import { processMetadata } from './processors/metadata'
import { processCover } from './processors/cover'
import { processAudioSubmit, processAudioPoll } from './processors/audio'
import { processRetry } from './processors/retry'

const POLL_INTERVAL = 2000 // 2 seconds

// Per-playlist concurrency flags
const playlistState = new Map<Id<"playlists">, {
  llmBusy: boolean
  coverBusy: boolean
  submitBusy: boolean
  saveBusy: boolean
  abortController: AbortController
}>()

function getPlaylistState(playlistId: Id<"playlists">) {
  let state = playlistState.get(playlistId)
  if (!state) {
    state = {
      llmBusy: false,
      coverBusy: false,
      submitBusy: false,
      saveBusy: false,
      abortController: new AbortController(),
    }
    playlistState.set(playlistId, state)
  }
  return state
}

async function tick() {
  const convex = getConvexClient()

  try {
    // 1. Get playlists the worker should process (active + closing)
    const workerPlaylists = await convex.query(api.playlists.listWorkerPlaylists)
    const workerPlaylistIds = new Set(workerPlaylists.map((s) => s._id))

    // Clean up playlists that fully disappeared (force-closed or deleted)
    for (const [playlistId, state] of playlistState.entries()) {
      if (!workerPlaylistIds.has(playlistId)) {
        console.log(`[worker] Playlist ${playlistId} gone, aborting in-flight work`)
        state.abortController.abort()
        playlistState.delete(playlistId)

        // Revert transient statuses as safety net
        try {
          await convex.mutation(api.songs.revertTransientStatuses, {
            playlistId,
          })
        } catch (e: unknown) {
          console.error(`[worker] Failed to revert statuses for ${playlistId}:`, e instanceof Error ? e.message : e)
        }
      }
    }

    if (workerPlaylists.length === 0) return

    // 2. Get settings for providers
    const settings = await convex.query(api.settings.getAll)
    const rawImageProvider = settings.imageProvider
    const imageProvider = rawImageProvider === 'ollama' ? 'comfyui' : rawImageProvider
    const imageModel = settings.imageModel
    const effectiveTextProvider = settings.textProvider || 'ollama'

    // 3. Process each playlist
    for (const playlist of workerPlaylists) {
      const playlistId = playlist._id
      const isClosing = playlist.status === 'closing'
      const state = getPlaylistState(playlistId)
      const signal = state.abortController.signal

      try {
        const workQueue = await convex.query(api.songs.getWorkQueue, {
          playlistId,
        })

        // === Active playlists only: create new pending songs ===
        const isOneshot = playlist.mode === 'oneshot'
        if (!isClosing) {
          // Queue Keeper: maintain buffer
          // Oneshot mode: only create 1 song total
          const shouldCreateSong = isOneshot
            ? workQueue.totalSongs === 0
            : workQueue.bufferDeficit > 0
          if (shouldCreateSong) {
            await processQueueKeeper(convex, playlistId, isOneshot ? 1 : workQueue.bufferDeficit, workQueue.maxOrderIndex)
          }

          // Retry Processor: revert retry_pending songs (only active — closing playlists shouldn't retry)
          if (workQueue.retryPending.length > 0) {
            await processRetry(convex, workQueue.retryPending)
          }
        }

        // === Both active and closing: finish in-flight work ===

        // Metadata Processor: one at a time for ollama (local), concurrent for openrouter (remote)
        const llmConcurrent = effectiveTextProvider !== 'ollama'
        if (workQueue.pending.length > 0 && (llmConcurrent || !state.llmBusy)) {
          state.llmBusy = true
          processMetadata(convex, playlist, workQueue.pending, workQueue.recentCompleted, workQueue.recentDescriptions, signal, llmConcurrent)
            .finally(() => { state.llmBusy = false })
        }

        // Cover Processor: one at a time for local providers, concurrent for comfyui (has its own queue)
        const coverConcurrent = imageProvider === 'comfyui'
        if (workQueue.needsCover.length > 0 && (coverConcurrent || !state.coverBusy)) {
          state.coverBusy = true
          processCover(convex, workQueue.needsCover, imageProvider, imageModel, signal, coverConcurrent)
            .finally(() => { state.coverBusy = false })
        }

        // Audio Submit: only when no songs are already generating audio (1 at a time)
        if (workQueue.metadataReady.length > 0 && !state.submitBusy && workQueue.generatingAudio.length === 0) {
          state.submitBusy = true
          processAudioSubmit(convex, playlist, workQueue.metadataReady, signal)
            .finally(() => { state.submitBusy = false })
        }

        // Audio Poll: poll all generating_audio songs (concurrent)
        if (workQueue.generatingAudio.length > 0) {
          processAudioPoll(convex, playlistId, workQueue.generatingAudio, signal)
        }

        // === Stale song cleanup: remove songs stuck in transient states ===
        if (workQueue.staleSongs.length > 0) {
          for (const stale of workQueue.staleSongs) {
            console.log(`  [stale] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`)
            await convex.mutation(api.songs.deleteSong, { id: stale._id })
          }
        }

        // === Oneshot auto-close: when the single song is done ===
        if (isOneshot && !isClosing && workQueue.transientCount === 0 && workQueue.totalSongs > 0) {
          console.log(`[worker] Oneshot playlist ${playlistId} complete, setting to closing`)
          await convex.mutation(api.playlists.updateStatus, {
            id: playlistId,
            status: 'closing',
          })
        }

        // === Closing playlists: check if all work is done ===
        if (isClosing && workQueue.transientCount === 0) {
          console.log(`[worker] Playlist ${playlistId} closing complete, setting to closed`)
          await convex.mutation(api.playlists.updateStatus, {
            id: playlistId,
            status: 'closed',
          })
          state.abortController.abort()
          playlistState.delete(playlistId)
        }
      } catch (error: unknown) {
        console.error(`[worker] Error processing playlist ${playlistId}:`, error instanceof Error ? error.message : error)
      }
    }
  } catch (error: unknown) {
    console.error('[worker] Tick error:', error instanceof Error ? error.message : error)
  }
}

async function main() {
  console.log('[worker] Starting song generation worker...')
  console.log(`[worker] Polling interval: ${POLL_INTERVAL}ms`)

  // Verify Convex connection and recover from any previous crash
  const convex = getConvexClient()
  try {
    const playlists = await convex.query(api.playlists.listWorkerPlaylists)
    console.log(`[worker] Connected to Convex. ${playlists.length} worker playlist(s)`)

    // Recover songs stuck in transient statuses from previous worker instance
    for (const playlist of playlists) {
      try {
        const recovered = await convex.mutation(api.songs.recoverFromWorkerRestart, {
          playlistId: playlist._id,
        })
        if (recovered > 0) {
          console.log(`[worker] Recovered ${recovered} song(s) in playlist ${playlist._id}`)
        }
      } catch (e: unknown) {
        console.error(`[worker] Recovery failed for playlist ${playlist._id}:`, e instanceof Error ? e.message : e)
      }
    }
  } catch (error: unknown) {
    console.error('[worker] Failed to connect to Convex:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  console.log('[worker] Worker started')

  // Main loop
  const loop = async () => {
    while (true) {
      await tick()
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
    }
  }

  loop().catch((error) => {
    console.error('[worker] Fatal error:', error)
    process.exit(1)
  })
}

main()
