import { getConvexClient } from './convex-client'
import { api } from '../convex/_generated/api'
import type { Doc, Id } from '../convex/_generated/dataModel'
import { pollAce, batchPollAce } from '../src/services/ace'
import { EndpointQueues } from './queues'
import { SongWorker } from './song-worker'
import { startHttpServer } from './http-server'
import type { RecentSong } from '../src/services/llm'
import { generatePersonaExtract } from '../src/services/llm'
import { calculatePriority, PERSONA_PRIORITY } from './priority'

const POLL_INTERVAL = 2000 // 2 seconds
const HEARTBEAT_STALE_MS = 90_000 // 90 seconds = 3 missed 30s heartbeats

// ─── State ───────────────────────────────────────────────────────────

/** Active song workers keyed by songId */
const songWorkers = new Map<Id<"songs">, SongWorker>()

/** Reverse index: playlist → set of active song IDs */
const playlistSongs = new Map<Id<"playlists">, Set<Id<"songs">>>()

/** Tracked playlist IDs from last tick */
const trackedPlaylists = new Set<Id<"playlists">>()

/** Last-seen promptEpoch per playlist, for detecting epoch changes */
const playlistEpochs = new Map<Id<"playlists">, number>()

let queues: EndpointQueues

// ─── Persona scan state ─────────────────────────────────────────────

const personaPending = new Set<Id<"songs">>()
let lastPersonaScanAt = 0
const PERSONA_SCAN_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
let forcePersonaScan = false

// ─── Helpers ─────────────────────────────────────────────────────────

async function getSettings(): Promise<{ textProvider: string; textModel: string; imageProvider: string; imageModel?: string; personaProvider: string; personaModel: string }> {
  const convex = getConvexClient()
  const settings = await convex.query(api.settings.getAll)
  return {
    textProvider: settings.textProvider || 'ollama',
    textModel: settings.textModel || '',
    imageProvider: settings.imageProvider || 'comfyui',
    imageModel: settings.imageModel,
    personaProvider: settings.personaProvider || '',
    personaModel: settings.personaModel || '',
  }
}

// ─── Persona scan ───────────────────────────────────────────────────

async function runPersonaScan(settings: Awaited<ReturnType<typeof getSettings>>) {
  const convex = getConvexClient()
  const needsPersona = await convex.query(api.songs.listNeedsPersona)
  if (needsPersona.length === 0) return

  // Resolve persona provider + model:
  // 1. Both explicitly set → use them
  // 2. Neither set (or persona provider matches text provider) → fall back to text pair
  // 3. Persona provider set but model empty + different from text provider → skip (can't mix)
  const explicitPersonaProvider = settings.personaProvider || ''
  const explicitPersonaModel = settings.personaModel && settings.personaModel !== '__fallback__' ? settings.personaModel : ''
  let pProvider: 'ollama' | 'openrouter'
  let pModel: string
  if (explicitPersonaModel) {
    pProvider = (explicitPersonaProvider || 'ollama') as 'ollama' | 'openrouter'
    pModel = explicitPersonaModel
  } else if (!explicitPersonaProvider || explicitPersonaProvider === settings.textProvider) {
    pProvider = (settings.textProvider || 'ollama') as 'ollama' | 'openrouter'
    pModel = settings.textModel
  } else {
    console.log(`[persona] Skipping scan: personaProvider is "${explicitPersonaProvider}" but no personaModel set (textProvider is "${settings.textProvider}")`)
    return
  }
  if (!pModel) return

  for (const song of needsPersona) {
    if (personaPending.has(song._id)) continue
    personaPending.add(song._id)
    console.log(`[persona] Queuing "${song.title}" (${song._id})`)

    queues.llm.enqueue({
      songId: song._id,
      priority: PERSONA_PRIORITY,
      endpoint: pProvider,
      execute: async (signal) => {
        return await generatePersonaExtract({
          song: {
            title: song.title,
            artistName: song.artistName,
            genre: song.genre,
            subGenre: song.subGenre,
            mood: song.mood,
            energy: song.energy,
            era: song.era,
            vocalStyle: song.vocalStyle,
            instruments: song.instruments,
            themes: song.themes,
            description: song.description,
            lyrics: song.lyrics?.slice(0, 500),
          },
          provider: pProvider,
          model: pModel,
          signal,
        })
      },
    }).then(async ({ result, processingMs }) => {
      await convex.mutation(api.songs.updatePersonaExtract, {
        id: song._id,
        personaExtract: result as string,
      })
      console.log(`[persona] Done "${song.title}" (${processingMs}ms)`)
    }).catch((err) => {
      console.error(`[persona] Failed "${song.title}":`, err instanceof Error ? err.message : err)
    }).finally(() => {
      personaPending.delete(song._id)
    })
  }

  lastPersonaScanAt = Date.now()
}

export function triggerPersonaScan() {
  forcePersonaScan = true
  console.log('[persona] Manual scan triggered, will run next tick')
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
        playlistEpochs.delete(playlistId)
      }
    }

    // 5. Process each playlist
    for (const playlist of workerPlaylists) {
      trackedPlaylists.add(playlist._id)
      const playlistId = playlist._id
      const isClosing = playlist.status === 'closing'
      const isOneshot = playlist.mode === 'oneshot'

      // Track epoch changes
      const currentEpoch = playlist.promptEpoch ?? 0
      const lastSeenEpoch = playlistEpochs.get(playlistId) ?? currentEpoch
      playlistEpochs.set(playlistId, currentEpoch)
      const epochChanged = currentEpoch > lastSeenEpoch

      try {
        const workQueue = await convex.query(api.songs.getWorkQueue, { playlistId })

        // === Epoch change: recalculate priorities for pending queue items ===
        if (epochChanged) {
          console.log(`[epoch] Epoch changed ${lastSeenEpoch} → ${currentEpoch} for playlist ${playlistId}`)

          // Build songId → song lookup from all songs in the work queue
          const allSongs = [
            ...workQueue.pending,
            ...workQueue.metadataReady,
            ...workQueue.generatingAudio,
            ...workQueue.needsRecovery,
          ]
          const songMap = new Map(allSongs.map((s) => [s._id, s]))

          queues.recalcPendingPriorities((songId) => {
            const song = songMap.get(songId)
            if (!song) return undefined
            return calculatePriority({
              isOneshot,
              isInterrupt: !!song.interruptPrompt,
              orderIndex: song.orderIndex,
              currentOrderIndex: playlist.currentOrderIndex ?? 0,
              isClosing,
              currentEpoch,
              songEpoch: song.promptEpoch ?? 0,
            })
          })
        }

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
              promptEpoch: playlist.promptEpoch ?? 0,
            })
            console.log(`  [queue-keeper] Created pending song at order ${orderIndex} (deficit: ${workQueue.bufferDeficit}, epoch: ${playlist.promptEpoch ?? 0})`)
          }

          // Retry: revert retry_pending songs
          if (workQueue.retryPending.length > 0) {
            for (const song of workQueue.retryPending) {
              console.log(`  [retry] Reverting song ${song._id} (retry ${(song.retryCount || 0) + 1}/3)`)
              await convex.mutation(api.songs.retryErroredSong, { id: song._id })
            }
          }
        }

        // === Epoch cleanup: delete old-epoch pending songs (zero work done) ===
        // Songs past pending have started LLM/audio work — let them finish at low priority.
        const deletedSongIds = new Set<string>()
        if (!isClosing) {
          const oldPending = workQueue.pending.filter(
            (s) => (s.promptEpoch ?? 0) < currentEpoch && !s.isInterrupt
          )
          for (const song of oldPending) {
            const w = songWorkers.get(song._id)
            if (w) w.cancel()
            await convex.mutation(api.songs.deleteSong, { id: song._id })
            deletedSongIds.add(song._id)
            console.log(`  [epoch-cleanup] Deleted old-epoch pending song ${song._id} (epoch ${song.promptEpoch ?? 0} < ${currentEpoch})`)
          }
        }

        // === Both active and closing: create SongWorkers for actionable songs ===
        // Sort: current-epoch first so they claim queue slots before old-epoch songs.
        const actionableSongs = [
          ...workQueue.pending,
          ...workQueue.metadataReady,
          ...workQueue.generatingAudio,
          ...workQueue.needsRecovery,
        ]
          .filter((s) => !deletedSongIds.has(s._id))
          .sort((a, b) => {
            const aEpoch = (a.promptEpoch ?? 0) === currentEpoch ? 0 : 1
            const bEpoch = (b.promptEpoch ?? 0) === currentEpoch ? 0 : 1
            return aEpoch - bEpoch
          })

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
            getCurrentEpoch: () => playlistEpochs.get(playlistId) ?? 0,
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
          playlistEpochs.delete(playlistId)
        }
      } catch (error: unknown) {
        console.error(`[worker] Error processing playlist ${playlistId}:`, error instanceof Error ? error.message : error)
      }
    }

    // 6. Persona scan — daily or on manual trigger
    const now = Date.now()
    if (forcePersonaScan || (now - lastPersonaScanAt > PERSONA_SCAN_INTERVAL)) {
      forcePersonaScan = false
      try {
        await runPersonaScan(settings)
      } catch (err) {
        console.error('[persona] Scan error:', err instanceof Error ? err.message : err)
      }
    }

    // 7. Tick audio polls (only tick-driven endpoint)
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

// ─── Startup ACE reconciliation ─────────────────────────────────────

async function reconcileAceState() {
  const convex = getConvexClient()
  const songs = await convex.query(api.songs.getInAudioPipeline)
  if (songs.length === 0) return

  console.log(`[startup] Reconciling ${songs.length} song(s) in audio pipeline...`)

  const taskIds = songs.filter(s => s.aceTaskId).map(s => s.aceTaskId!)

  if (taskIds.length > 0) {
    let aceStatus: Map<string, { status: string; audioPath?: string }>
    try {
      aceStatus = await batchPollAce(taskIds)
    } catch (error: unknown) {
      console.log(`[startup] ACE unreachable, reverting all ${songs.length} songs to metadata_ready`)
      for (const song of songs) {
        await convex.mutation(api.songs.revertToMetadataReady, { id: song._id })
      }
      return
    }

    for (const song of songs) {
      if (!song.aceTaskId) {
        await convex.mutation(api.songs.revertToMetadataReady, { id: song._id })
        console.log(`[startup] Reverted ${song._id} — no ACE task ID`)
        continue
      }
      const status = aceStatus.get(song.aceTaskId)
      if (!status || status.status === 'not_found' || status.status === 'failed') {
        await convex.mutation(api.songs.revertToMetadataReady, { id: song._id })
        console.log(`[startup] Reverted ${song._id} — ACE task ${song.aceTaskId} is gone`)
      } else if (status.status === 'succeeded' && status.audioPath) {
        console.log(`[startup] ACE task ${song.aceTaskId} already done — SongWorker will save`)
      } else {
        console.log(`[startup] ACE task ${song.aceTaskId} still running — will resume`)
      }
    }
  } else {
    // All songs in audio pipeline have no taskId — revert all
    for (const song of songs) {
      await convex.mutation(api.songs.revertToMetadataReady, { id: song._id })
      console.log(`[startup] Reverted ${song._id} — no ACE task ID`)
    }
  }
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

  // Reconcile any songs stuck in audio pipeline against ACE's actual state
  await reconcileAceState()

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
    onTriggerPersonaScan: triggerPersonaScan,
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
