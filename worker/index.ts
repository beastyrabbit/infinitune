import { getConvexClient } from './convex-client'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { processQueueKeeper } from './processors/queue-keeper'
import { processMetadata } from './processors/metadata'
import { processCover } from './processors/cover'
import { processAudioSubmit, processAudioPoll } from './processors/audio'
import { processRetry } from './processors/retry'

const POLL_INTERVAL = 2000 // 2 seconds

// Per-session concurrency flags
const sessionState = new Map<Id<"sessions">, {
  llmBusy: boolean
  coverBusy: boolean
  submitBusy: boolean
  saveBusy: boolean
  abortController: AbortController
}>()

function getSessionState(sessionId: Id<"sessions">) {
  let state = sessionState.get(sessionId)
  if (!state) {
    state = {
      llmBusy: false,
      coverBusy: false,
      submitBusy: false,
      saveBusy: false,
      abortController: new AbortController(),
    }
    sessionState.set(sessionId, state)
  }
  return state
}

async function tick() {
  const convex = getConvexClient()

  try {
    // 1. Get sessions the worker should process (active + closing)
    const workerSessions = await convex.query(api.sessions.listWorkerSessions)
    const workerSessionIds = new Set(workerSessions.map((s) => s._id))

    // Clean up sessions that fully disappeared (force-closed or deleted)
    for (const [sessionId, state] of sessionState.entries()) {
      if (!workerSessionIds.has(sessionId)) {
        console.log(`[worker] Session ${sessionId} gone, aborting in-flight work`)
        state.abortController.abort()
        sessionState.delete(sessionId)

        // Revert transient statuses as safety net
        try {
          await convex.mutation(api.songs.revertTransientStatuses, {
            sessionId,
          })
        } catch (e: any) {
          console.error(`[worker] Failed to revert statuses for ${sessionId}:`, e.message)
        }
      }
    }

    if (workerSessions.length === 0) return

    // 2. Get settings for image provider
    const settings = await convex.query(api.settings.getAll)
    const rawImageProvider = settings.imageProvider
    const imageProvider = rawImageProvider === 'ollama' ? 'comfyui' : rawImageProvider
    const imageModel = settings.imageModel

    // 3. Process each session
    for (const session of workerSessions) {
      const sessionId = session._id
      const isClosing = session.status === 'closing'
      const state = getSessionState(sessionId)
      const signal = state.abortController.signal

      try {
        const workQueue = await convex.query(api.songs.getWorkQueue, {
          sessionId,
        })

        // === Active sessions only: create new pending songs ===
        if (!isClosing) {
          // Queue Keeper: maintain buffer
          if (workQueue.bufferDeficit > 0) {
            await processQueueKeeper(convex, sessionId, workQueue.bufferDeficit, workQueue.maxOrderIndex)
          }

          // Retry Processor: revert retry_pending songs (only active — closing sessions shouldn't retry)
          if (workQueue.retryPending.length > 0) {
            await processRetry(convex, workQueue.retryPending)
          }
        }

        // === Both active and closing: finish in-flight work ===

        // Metadata Processor: one at a time per session
        if (workQueue.pending.length > 0 && !state.llmBusy) {
          state.llmBusy = true
          processMetadata(convex, session, workQueue.pending, workQueue.recentCompleted, workQueue.recentDescriptions, signal)
            .finally(() => { state.llmBusy = false })
        }

        // Cover Processor: one at a time per session
        if (workQueue.needsCover.length > 0 && !state.coverBusy) {
          state.coverBusy = true
          processCover(convex, workQueue.needsCover, imageProvider, imageModel, signal)
            .finally(() => { state.coverBusy = false })
        }

        // Audio Submit: only when no songs are already generating audio (1 at a time)
        if (workQueue.metadataReady.length > 0 && !state.submitBusy && workQueue.generatingAudio.length === 0) {
          state.submitBusy = true
          processAudioSubmit(convex, session, workQueue.metadataReady, signal)
            .finally(() => { state.submitBusy = false })
        }

        // Audio Poll: poll all generating_audio songs (concurrent)
        if (workQueue.generatingAudio.length > 0) {
          processAudioPoll(convex, sessionId, workQueue.generatingAudio, signal)
        }

        // === Stale song cleanup: remove songs stuck in transient states ===
        if (workQueue.staleSongs.length > 0) {
          for (const stale of workQueue.staleSongs) {
            console.log(`  [stale] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`)
            await convex.mutation(api.songs.deleteSong, { id: stale._id })
          }
        }

        // === Closing sessions: check if all work is done ===
        if (isClosing && workQueue.transientCount === 0) {
          console.log(`[worker] Session ${sessionId} closing complete, setting to closed`)
          await convex.mutation(api.sessions.updateStatus, {
            id: sessionId,
            status: 'closed',
          })
          state.abortController.abort()
          sessionState.delete(sessionId)
        }
      } catch (error: any) {
        console.error(`[worker] Error processing session ${sessionId}:`, error.message)
      }
    }
  } catch (error: any) {
    console.error('[worker] Tick error:', error.message)
  }
}

async function main() {
  console.log('[worker] Starting song generation worker...')
  console.log(`[worker] Polling interval: ${POLL_INTERVAL}ms`)

  // Verify Convex connection and recover from any previous crash
  const convex = getConvexClient()
  try {
    const sessions = await convex.query(api.sessions.listWorkerSessions)
    console.log(`[worker] Connected to Convex. ${sessions.length} worker session(s)`)

    // Recover songs stuck in transient statuses from previous worker instance
    for (const session of sessions) {
      try {
        const recovered = await convex.mutation(api.songs.recoverFromWorkerRestart, {
          sessionId: session._id,
        })
        if (recovered > 0) {
          console.log(`[worker] Recovered ${recovered} song(s) in session ${session._id}`)
        }
      } catch (e: any) {
        console.error(`[worker] Recovery failed for session ${session._id}:`, e.message)
      }
    }
  } catch (error: any) {
    console.error('[worker] Failed to connect to Convex:', error.message)
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
