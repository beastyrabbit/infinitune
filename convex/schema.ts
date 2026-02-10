import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  // EXISTING
  products: defineTable({
    title: v.string(),
    imageId: v.string(),
    price: v.number(),
  }),
  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
  }),

  // NEW tables
  sessions: defineTable({
    name: v.string(),
    prompt: v.string(),
    llmProvider: v.string(), // "ollama" | "openrouter"
    llmModel: v.string(),
    status: v.string(), // "active" | "paused" | "stopped"
    songsGenerated: v.number(),
    lyricsLanguage: v.optional(v.string()),
    targetBpm: v.optional(v.number()),
    targetKey: v.optional(v.string()),
    timeSignature: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    inferenceSteps: v.optional(v.number()),
  }),

  songs: defineTable({
    sessionId: v.id("sessions"),
    orderIndex: v.number(),
    title: v.optional(v.string()),
    artistName: v.optional(v.string()),
    genre: v.optional(v.string()),
    subGenre: v.optional(v.string()),
    lyrics: v.optional(v.string()),
    caption: v.optional(v.string()),
    coverPrompt: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    coverStorageId: v.optional(v.id("_storage")),
    bpm: v.optional(v.number()),
    keyScale: v.optional(v.string()),
    timeSignature: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    status: v.string(), // "pending" | "generating_metadata" | "metadata_ready" | "submitting_to_ace" | "generating_audio" | "saving" | "ready" | "playing" | "played" | "error" | "retry_pending"
    aceTaskId: v.optional(v.string()),
    aceSubmittedAt: v.optional(v.number()),
    audioUrl: v.optional(v.string()),
    storagePath: v.optional(v.string()),
    aceAudioPath: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    cancelledAtStatus: v.optional(v.string()), // deprecated, kept for existing data
    retryCount: v.optional(v.number()),
    erroredAtStatus: v.optional(v.string()),
    generationStartedAt: v.optional(v.number()),
    generationCompletedAt: v.optional(v.number()),
    isInterrupt: v.optional(v.boolean()),
    interruptPrompt: v.optional(v.string()),
  }).index("by_session", ["sessionId"])
    .index("by_session_status", ["sessionId", "status"])
    .index("by_session_order", ["sessionId", "orderIndex"]),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
})
