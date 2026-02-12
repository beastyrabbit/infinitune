import { getConvexClient } from './convex-client'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'
import { pollAce } from '../src/services/ace'
import { EndpointQueues } from './queues'
import { SongWorker } from './song-worker'
import { startHttpServer } from './http-server'
import type { RecentSong } from '../src/services/llm'

const POLL_INTERVAL = 2000 // 2 seconds
const HEARTBEAT_STALE_MS = 90_000 // 90 seconds = 3 missed 30s heartbeats

// ─── State ───────────────────────────────────────────────────────────

/** Active song workers keyed by songId */
const songWorkers = new Map<Id<"songs">, SongWorker>()

/** Reverse index: playlist → set of active song IDs */
const playlistSongs = new Map<Id<"playlists">, Set<Id<"songs">>>()

/** Tracked playlist IDs from last tick */
const trackedPlaylists = new Set<Id<"playlists">>()

let queues: EndpointQueues

// ─── Helpers ─────────────────────────────────────────────────────────

async function getSettings(): Promise<{ textProvider: string; textModel: string; imageProvider: string; imageModel?: string }> {
  const convex = getConvexClient()
  const settings = await convex.query(api.settings.getAll)
  return {
    textProvider: settings.textProvider || 'ollama',
    textModel: settings.textModel || '',
    imageProvider: settings.imageProvider || 'comfyui',
    imageModel: settings.imageModel,
  }
}

// ─── Tick ────────────────────────────────────────────────────────────

async function tick() {
  const convex = getConvexClient()

  try {
    // 1. Fetch active + closing playlists
    const workerPlaylists = await convex.query(api.playlists.listWorkerPlaylists)
    const workerPlaylistIds = new Set(workerPlaylists.map((p) => p._id))

    // 2. Fetch settings, refresh queue concurrency
    const settings = await getSettings()
    queues.refreshAll(settings)

    // 3. Check heartbeats — flag stale playlists as closing
    for (const playlist of workerPlaylists) {
      if (playlist.status === 'active' && playlist.lastSeenAt) {
        const elapsed = Date.now() - playlist.lastSeenAt
        if (elapsed > HEARTBEAT_STALE_MS) {
          console.log(`[worker] Playlist ${playlist._id} stale (no heartbeat for ${Math.round(elapsed / 1000)}s), setting to closing`)
          await convex.mutation(api.playlists.updateStatus, {
            id: playlist._id,
            status: 'closing',
          })
        }
      }
    }

    // 4. Cleanup disappeared playlists (cancel song workers + queued requests)
    for (const playlistId of trackedPlaylists) {
      if (!workerPlaylistIds.has(playlistId)) {
        console.log(`[worker] Playlist ${playlistId} gone, cancelling workers`)
        cancelPlaylistWorkers(playlistId)
        trackedPlaylists.delete(playlistId)
      }
    }

    // 5. Process each playlist
    for (const playlist of workerPlaylists) {
      trackedPlaylists.add(playlist._id)
      const playlistId = playlist._id
      const isClosing = playlist.status === 'closing'
      const isOneshot = playlist.mode === 'oneshot'

      try {
        const workQueue = await convex.query(api.songs.getWorkQueue, { playlistId })

        // === Active playlists only: buffer management + retry ===
        if (!isClosing) {
          // Queue Keeper: maintain buffer (create 1 pending song per tick)
          const shouldCreateSong = isOneshot
            ? workQueue.totalSongs === 0
            : workQueue.bufferDeficit > 0
          if (shouldCreateSong) {
            const orderIndex = Math.ceil(workQueue.maxOrderIndex) + 1
            await convex.mutation(api.songs.createPending, {
              playlistId,
              orderIndex,
            })
            console.log(`  [queue-keeper] Created pending song at order ${orderIndex} (deficit: ${workQueue.bufferDeficit})`)
          }

          // Retry: revert retry_pending songs
          if (workQueue.retryPending.length > 0) {
            for (const song of workQueue.retryPending) {
              console.log(`  [retry] Reverting song ${song._id} (retry ${(song.retryCount || 0) + 1}/3)`)
              await convex.mutation(api.songs.retryErroredSong, { id: song._id })
            }
          }
        }

        // === Both active and closing: create SongWorkers for actionable songs ===
        const actionableSongs = [
          ...workQueue.pending,
          ...workQueue.metadataReady,
          ...workQueue.generatingAudio,
          ...workQueue.needsRecovery,
        ]

        for (const song of actionableSongs) {
          if (songWorkers.has(song._id)) continue // Already tracked

          const worker = new SongWorker(song as Doc<"songs">, {
            convex,
            queues,
            playlist: playlist as Doc<"playlists">,
            recentSongs: workQueue.recentCompleted as RecentSong[],
            recentDescriptions: workQueue.recentDescriptions,
            getPlaylistActive: async () => {
              const pl = await convex.query(api.playlists.get, { id: playlistId })
              return pl?.status === 'active'
            },
            getSettings,
          })
          songWorkers.set(song._id, worker)

          // Track song → playlist for reverse lookup
          let songSet = playlistSongs.get(playlistId)
          if (!songSet) {
            songSet = new Set()
            playlistSongs.set(playlistId, songSet)
          }
          songSet.add(song._id)

          // Fire-and-forget
          worker.run().finally(() => {
            songWorkers.delete(song._id)
            const set = playlistSongs.get(playlistId)
            if (set) {
              set.delete(song._id)
              if (set.size === 0) playlistSongs.delete(playlistId)
            }
          })
        }

        // === Stale song cleanup ===
        if (workQueue.staleSongs.length > 0) {
          for (const stale of workQueue.staleSongs) {
            console.log(`  [stale] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`)
            // Cancel any worker for this song
            const w = songWorkers.get(stale._id)
            if (w) w.cancel()
            await convex.mutation(api.songs.deleteSong, { id: stale._id })
          }
        }

        // === Oneshot auto-close ===
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
          cancelPlaylistWorkers(playlistId)
          trackedPlaylists.delete(playlistId)
        }
      } catch (error: unknown) {
        console.error(`[worker] Error processing playlist ${playlistId}:`, error instanceof Error ? error.message : error)
      }
    }

    // 6. Tick audio polls (only tick-driven endpoint)
    await queues.audio.tickPolls()
  } catch (error: unknown) {
    console.error('[worker] Tick error:', error instanceof Error ? error.message : error)
  }
}

function cancelPlaylistWorkers(playlistId: Id<"playlists">): void {
  const songIds = playlistSongs.get(playlistId)
  if (songIds) {
    for (const songId of songIds) {
      const worker = songWorkers.get(songId)
      if (worker) worker.cancel()
    }
  }
  playlistSongs.delete(playlistId)
}

// ─── Startup ─────────────────────────────────────────────────────────

async function main() {
  console.log('[worker] Starting song generation worker...')
  console.log(`[worker] Poll interval: ${POLL_INTERVAL}ms`)

  const convex = getConvexClient()

  // Verify Convex connection
  try {
    const playlists = await convex.query(api.playlists.listWorkerPlaylists)
    console.log(`[worker] Connected to Convex. ${playlists.length} worker playlist(s)`)
  } catch (error: unknown) {
    console.error('[worker] Failed to connect to Convex:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  // Initialize endpoint queues
  queues = new EndpointQueues(
    (taskId, signal) => pollAce(taskId, signal),
  )

  // Start HTTP server for queue status API
  const port = Number(process.env.WORKER_API_PORT) || 3099
  const startTime = Date.now()
  startHttpServer({
    queues,
    getSongWorkerCount: () => songWorkers.size,
    getPlaylistInfo: () => {
      // Return basic playlist info
      return [...trackedPlaylists].map((id) => ({
        id: id as string,
        name: id as string,
        activeSongWorkers: 0, // TODO: count per-playlist
      }))
    },
    startTime,
  }, port)

  console.log('[worker] Worker started')

  // Main loop
  while (true) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
  }
}

main().catch((error) => {
  console.error('[worker] Fatal error:', error)
  process.exit(1)
})
