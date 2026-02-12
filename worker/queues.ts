import type { Id } from '../convex/_generated/dataModel'
import type { EndpointType, IEndpointQueue, QueueStatus } from './endpoint-queue'
import { RequestResponseQueue } from './request-response-queue'
import { AudioQueue } from './audio-queue'
import type { SongMetadata } from '../src/services/llm'
import type { AcePollResult } from '../src/services/ace'

// ─── Concurrency defaults by provider ────────────────────────────────
const LLM_CONCURRENCY: Record<string, number> = {
  ollama: 1,
  openrouter: 5,
}

const IMAGE_CONCURRENCY: Record<string, number> = {
  comfyui: 1,
  openrouter: 1,
}

// ─── Cover generation result ─────────────────────────────────────────
export interface CoverResult {
  imageBase64: string
}

// ─── Container ───────────────────────────────────────────────────────
export class EndpointQueues {
  readonly llm: RequestResponseQueue<SongMetadata>
  readonly image: RequestResponseQueue<CoverResult>
  readonly audio: AudioQueue

  constructor(
    pollFn: (taskId: string, signal: AbortSignal) => Promise<AcePollResult>,
  ) {
    this.llm = new RequestResponseQueue<SongMetadata>('llm', LLM_CONCURRENCY.ollama)
    this.image = new RequestResponseQueue<CoverResult>('image', IMAGE_CONCURRENCY.comfyui)
    this.audio = new AudioQueue(pollFn)
  }

  get(type: EndpointType): IEndpointQueue<unknown> {
    switch (type) {
      case 'llm': return this.llm
      case 'image': return this.image
      case 'audio': return this.audio
    }
  }

  /** Update concurrency based on current provider settings */
  refreshAll(settings: { textProvider: string; imageProvider: string }): void {
    const llmConcurrency = LLM_CONCURRENCY[settings.textProvider] || LLM_CONCURRENCY.ollama
    const imageProvider = settings.imageProvider === 'ollama' ? 'comfyui' : settings.imageProvider
    const imageConcurrency = IMAGE_CONCURRENCY[imageProvider] || IMAGE_CONCURRENCY.comfyui

    this.llm.refreshConcurrency(llmConcurrency)
    this.image.refreshConcurrency(imageConcurrency)
    // Audio submit concurrency is always 1
  }

  cancelAllForSong(songId: Id<"songs">): void {
    this.llm.cancelSong(songId)
    this.image.cancelSong(songId)
    this.audio.cancelSong(songId)
  }

  getFullStatus(): Record<EndpointType, QueueStatus> {
    return {
      llm: this.llm.getStatus(),
      image: this.image.getStatus(),
      audio: this.audio.getStatus(),
    }
  }

  /** Re-sort pending items in all queues (e.g., when playlist priority changes) */
  resortAll(): void {
    this.llm.resortPending()
    this.image.resortPending()
    // Audio submit queue is internal to AudioQueue
  }
}
