import { v } from "convex/values"

// ─── Song Status ─────────────────────────────────────────────────────
export const SONG_STATUSES = [
  "pending",
  "generating_metadata",
  "metadata_ready",
  "submitting_to_ace",
  "generating_audio",
  "saving",
  "ready",
  "played",
  "error",
  "retry_pending",
] as const

export type SongStatus = (typeof SONG_STATUSES)[number]

export const songStatusValidator = v.union(
  v.literal("pending"),
  v.literal("generating_metadata"),
  v.literal("metadata_ready"),
  v.literal("submitting_to_ace"),
  v.literal("generating_audio"),
  v.literal("saving"),
  v.literal("ready"),
  v.literal("played"),
  v.literal("error"),
  v.literal("retry_pending"),
)

/** Statuses where the song is still being processed (not terminal) */
export const TRANSIENT_STATUSES: SongStatus[] = [
  "pending",
  "generating_metadata",
  "metadata_ready",
  "submitting_to_ace",
  "generating_audio",
  "saving",
  "retry_pending",
]

/** Statuses that count toward the active buffer (excludes terminal states) */
export const ACTIVE_STATUSES: SongStatus[] = [
  "pending",
  "generating_metadata",
  "metadata_ready",
  "submitting_to_ace",
  "generating_audio",
  "saving",
  "ready",
]

// ─── Session Status ──────────────────────────────────────────────────
export const SESSION_STATUSES = ["active", "closing", "closed"] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const sessionStatusValidator = v.union(
  v.literal("active"),
  v.literal("closing"),
  v.literal("closed"),
)

// ─── LLM Provider ────────────────────────────────────────────────────
export const LLM_PROVIDERS = ["ollama", "openrouter"] as const

export type LlmProvider = (typeof LLM_PROVIDERS)[number]

export const llmProviderValidator = v.union(
  v.literal("ollama"),
  v.literal("openrouter"),
)
