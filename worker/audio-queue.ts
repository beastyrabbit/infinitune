import type { Id } from '../convex/_generated/dataModel'
import type { IEndpointQueue, QueueRequest, QueueResult, QueueStatus } from './endpoint-queue'

// ─── Types ───────────────────────────────────────────────────────────

export interface AudioResult {
  taskId: string
  status: 'succeeded' | 'failed' | 'not_found' | 'running'
  audioPath?: string
  error?: string
  submitProcessingMs: number
}

interface PendingItem {
  request: QueueRequest<AudioResult>
  resolve: (result: QueueResult<AudioResult>) => void
  reject: (error: Error) => void
  enqueuedAt: number
  /** Set when resuming a poll for an already-submitted ACE task */
  resumeTaskId?: string
  resumeSubmittedAt?: number
}

interface ActiveSlot {
  songId: Id<"songs">
  taskId: string
  submittedAt: number
  submitProcessingMs: number
  resolve: (result: QueueResult<AudioResult>) => void
  reject: (error: Error) => void
  abortController: AbortController
}

// Grace period before treating "not_found" as a lost task (2 minutes)
const NOT_FOUND_GRACE_MS = 2 * 60 * 1000

// ─── AudioQueue ──────────────────────────────────────────────────────
/**
 * One song at a time through the entire submit→poll→done pipeline.
 * Priority queue determines order. The active slot stays occupied
 * from submit until audio is ready/failed/lost.
 *
 * tickPolls() is called every tick to check on the active song.
 */
export class AudioQueue implements IEndpointQueue<AudioResult> {
  readonly type = 'audio' as const

  /** Priority-sorted pending queue */
  private pending: PendingItem[] = []

  /** Single active slot — null when idle */
  private active: ActiveSlot | null = null

  /** Poll function injected by caller */
  private pollFn: (taskId: string, signal: AbortSignal) => Promise<{
    status: 'running' | 'succeeded' | 'failed' | 'not_found'
    audioPath?: string
    error?: string
  }>

  private errorCount = 0
  private lastErrorMessage?: string

  constructor(
    pollFn: AudioQueue['pollFn'],
  ) {
    this.pollFn = pollFn
  }

  enqueue(request: QueueRequest<AudioResult>): Promise<QueueResult<AudioResult>> {
    return new Promise<QueueResult<AudioResult>>((resolve, reject) => {
      const item: PendingItem = {
        request,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      }

      this.sortedInsert(item)
      this.drain()
    })
  }

  /**
   * Resume polling for a song already submitted (e.g., after worker restart).
   * Queued through the same single-slot pipeline to guarantee only 1 audio
   * task is active at a time. Gets priority 0 (highest) since ACE is already
   * working on it.
   */
  resumePoll(
    songId: Id<"songs">,
    taskId: string,
    submittedAt: number,
  ): Promise<QueueResult<AudioResult>> {
    return new Promise<QueueResult<AudioResult>>((resolve, reject) => {
      const item: PendingItem = {
        request: {
          songId,
          priority: 0, // Highest — already submitted, just needs polling
          execute: async () => { throw new Error('Should not be called for resumed polls') },
        },
        resolve,
        reject,
        enqueuedAt: Date.now(),
        resumeTaskId: taskId,
        resumeSubmittedAt: submittedAt,
      }

      this.sortedInsert(item)
      this.drain()
    })
  }

  /** Called every tick — polls the single active slot */
  async tickPolls(): Promise<void> {
    if (this.active) {
      await this.pollSlot(this.active, () => {
        this.active = null
        this.drain() // slot freed, process next
      })
    }
  }

  private async pollSlot(slot: ActiveSlot, onDone: () => void): Promise<void> {
    if (slot.abortController.signal.aborted) {
      onDone()
      return
    }

    try {
      const result = await this.pollFn(slot.taskId, slot.abortController.signal)

      if (slot.abortController.signal.aborted) return

      if (result.status === 'succeeded') {
        slot.resolve({
          result: {
            taskId: slot.taskId,
            status: 'succeeded',
            audioPath: result.audioPath,
            submitProcessingMs: slot.submitProcessingMs,
          },
          processingMs: Date.now() - slot.submittedAt,
        })
        onDone()
      } else if (result.status === 'failed') {
        this.errorCount++
        this.lastErrorMessage = result.error || 'Audio generation failed'
        slot.resolve({
          result: {
            taskId: slot.taskId,
            status: 'failed',
            error: result.error,
            submitProcessingMs: slot.submitProcessingMs,
          },
          processingMs: Date.now() - slot.submittedAt,
        })
        onDone()
      } else if (result.status === 'not_found') {
        const elapsed = Date.now() - slot.submittedAt
        if (elapsed >= NOT_FOUND_GRACE_MS) {
          slot.resolve({
            result: {
              taskId: slot.taskId,
              status: 'not_found',
              submitProcessingMs: slot.submitProcessingMs,
            },
            processingMs: elapsed,
          })
          onDone()
        }
        // else: within grace period, keep polling
      }
      // 'running' → do nothing, poll again next tick
    } catch (error: unknown) {
      if (slot.abortController.signal.aborted) return
      console.error(`  [audio-poll] Poll error for task ${slot.taskId}:`, error instanceof Error ? error.message : error)
    }
  }

  /** Sorted insert into pending queue: lower priority number = higher priority, FIFO tiebreak */
  private sortedInsert(item: PendingItem): void {
    const idx = this.pending.findIndex(
      (p) => p.request.priority > item.request.priority,
    )
    if (idx === -1) {
      this.pending.push(item)
    } else {
      this.pending.splice(idx, 0, item)
    }
  }

  /** Try to process the next pending item if the slot is free */
  private drain(): void {
    if (this.active || this.pending.length === 0) return

    const item = this.pending.shift()!
    const abortController = new AbortController()

    // Resumed poll — no submission needed, just set up for polling
    if (item.resumeTaskId) {
      this.active = {
        songId: item.request.songId,
        taskId: item.resumeTaskId,
        submittedAt: item.resumeSubmittedAt ?? Date.now(),
        submitProcessingMs: 0,
        resolve: item.resolve,
        reject: item.reject,
        abortController,
      }
      return
    }

    // New submission — submit to ACE
    const submitStartedAt = Date.now()
    const placeholder: ActiveSlot = {
      songId: item.request.songId,
      taskId: '', // not yet known
      submittedAt: submitStartedAt,
      submitProcessingMs: 0,
      resolve: item.resolve,
      reject: item.reject,
      abortController,
    }
    this.active = placeholder

    item.request.execute(abortController.signal)
      .then((result) => {
        const submitProcessingMs = Date.now() - submitStartedAt
        // Fill in the real taskId + timing, keep slot occupied for polling
        placeholder.taskId = result.taskId
        placeholder.submittedAt = Date.now()
        placeholder.submitProcessingMs = submitProcessingMs
      })
      .catch((error: unknown) => {
        this.errorCount++
        this.lastErrorMessage = error instanceof Error ? error.message : String(error)
        item.reject(error instanceof Error ? error : new Error(String(error)))
        // Free the slot on submit failure
        this.active = null
        this.drain()
      })
  }

  cancelSong(songId: Id<"songs">): void {
    // Remove from pending (includes resumed polls waiting in queue)
    const idx = this.pending.findIndex((p) => p.request.songId === songId)
    if (idx !== -1) {
      const [removed] = this.pending.splice(idx, 1)
      removed.reject(new Error('Cancelled'))
    }

    // Cancel active slot
    if (this.active?.songId === songId) {
      this.active.abortController.abort()
      this.active.reject(new Error('Cancelled'))
      this.active = null
      this.drain()
    }
  }

  getStatus(): QueueStatus {
    const activeItems: { songId: string; startedAt: number }[] = []
    if (this.active) {
      activeItems.push({ songId: this.active.songId as string, startedAt: this.active.submittedAt })
    }

    return {
      type: 'audio',
      pending: this.pending.length,
      active: activeItems.length,
      errors: this.errorCount,
      lastErrorMessage: this.lastErrorMessage,
      activeItems,
      pendingItems: this.pending.map((p) => ({
        songId: p.request.songId as string,
        priority: p.request.priority,
        waitingSince: p.enqueuedAt,
      })),
    }
  }

  refreshConcurrency(_maxConcurrency: number): void {
    // Audio is always 1-at-a-time, nothing to change
  }

  get activePolls(): number {
    return this.active ? 1 : 0
  }
}
