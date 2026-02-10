import { v } from 'convex/values'
import { query, mutation } from './_generated/server'

export const listBySession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("songs")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .collect()
  },
})

export const getQueue = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    // Resolve coverStorageId → URL for songs that have it
    const resolved = await Promise.all(
      songs.map(async (song) => {
        if (song.coverStorageId && !song.coverUrl) {
          const url = await ctx.storage.getUrl(song.coverStorageId)
          return { ...song, coverUrl: url ?? undefined }
        }
        return song
      }),
    )
    return resolved.sort((a, b) => a.orderIndex - b.orderIndex)
  },
})

export const create = mutation({
  args: {
    sessionId: v.id("sessions"),
    orderIndex: v.number(),
    title: v.string(),
    artistName: v.string(),
    genre: v.string(),
    subGenre: v.string(),
    lyrics: v.string(),
    caption: v.string(),
    coverPrompt: v.optional(v.string()),
    bpm: v.number(),
    keyScale: v.string(),
    timeSignature: v.string(),
    audioDuration: v.number(),
    isInterrupt: v.optional(v.boolean()),
    interruptPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("songs", {
      ...args,
      status: "generating_metadata",
      generationStartedAt: Date.now(),
    })
  },
})

export const updateMetadata = mutation({
  args: {
    id: v.id("songs"),
    title: v.string(),
    artistName: v.string(),
    genre: v.string(),
    subGenre: v.string(),
    lyrics: v.string(),
    caption: v.string(),
    coverPrompt: v.optional(v.string()),
    bpm: v.number(),
    keyScale: v.string(),
    timeSignature: v.string(),
    audioDuration: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...metadata } = args
    await ctx.db.patch(id, metadata)
  },
})

export const updateStatus = mutation({
  args: {
    id: v.id("songs"),
    status: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: any = { status: args.status }
    if (args.errorMessage) patch.errorMessage = args.errorMessage
    await ctx.db.patch(args.id, patch)
  },
})

export const updateAceTask = mutation({
  args: {
    id: v.id("songs"),
    aceTaskId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      aceTaskId: args.aceTaskId,
      aceSubmittedAt: Date.now(),
      status: "generating_audio",
    })
  },
})

export const markReady = mutation({
  args: {
    id: v.id("songs"),
    audioUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      audioUrl: args.audioUrl,
      status: "ready",
      generationCompletedAt: Date.now(),
    })
  },
})

export const markError = mutation({
  args: {
    id: v.id("songs"),
    errorMessage: v.string(),
    erroredAtStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    const retryCount = song.retryCount || 0
    const canRetry = retryCount < 3
    await ctx.db.patch(args.id, {
      status: canRetry ? "retry_pending" : "error",
      errorMessage: args.errorMessage,
      erroredAtStatus: args.erroredAtStatus || song.status,
    })
  },
})

export const updateCover = mutation({
  args: {
    id: v.id("songs"),
    coverUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { coverUrl: args.coverUrl })
  },
})

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const updateCoverStorage = mutation({
  args: {
    id: v.id("songs"),
    coverStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.coverStorageId)
    await ctx.db.patch(args.id, {
      coverStorageId: args.coverStorageId,
      coverUrl: url ?? undefined,
    })
  },
})

export const updateStoragePath = mutation({
  args: {
    id: v.id("songs"),
    storagePath: v.string(),
    aceAudioPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, string> = { storagePath: args.storagePath }
    if (args.aceAudioPath) patch.aceAudioPath = args.aceAudioPath
    await ctx.db.patch(args.id, patch)
  },
})

export const get = query({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const getNextOrderIndex = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    if (songs.length === 0) return 1
    const maxOrder = Math.max(...songs.map((s) => s.orderIndex))
    return Math.ceil(maxOrder) + 1
  },
})

// ─── Worker mutations ───────────────────────────────────────────────

export const createPending = mutation({
  args: {
    sessionId: v.id("sessions"),
    orderIndex: v.number(),
    isInterrupt: v.optional(v.boolean()),
    interruptPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("songs", {
      sessionId: args.sessionId,
      orderIndex: args.orderIndex,
      status: "pending",
      isInterrupt: args.isInterrupt,
      interruptPrompt: args.interruptPrompt,
      generationStartedAt: Date.now(),
    })
  },
})

export const claimForMetadata = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song || song.status !== "pending") return false
    await ctx.db.patch(args.id, { status: "generating_metadata" })
    return true
  },
})

export const completeMetadata = mutation({
  args: {
    id: v.id("songs"),
    title: v.string(),
    artistName: v.string(),
    genre: v.string(),
    subGenre: v.string(),
    lyrics: v.string(),
    caption: v.string(),
    coverPrompt: v.optional(v.string()),
    bpm: v.number(),
    keyScale: v.string(),
    timeSignature: v.string(),
    audioDuration: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...metadata } = args
    await ctx.db.patch(id, {
      ...metadata,
      status: "metadata_ready",
    })
  },
})

export const claimForAudio = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song || song.status !== "metadata_ready") return false
    await ctx.db.patch(args.id, { status: "submitting_to_ace" })
    return true
  },
})

export const revertTransientStatuses = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()

    for (const song of songs) {
      if (song.status === "generating_metadata") {
        await ctx.db.patch(song._id, { status: "pending" })
      } else if (
        song.status === "submitting_to_ace" ||
        song.status === "generating_audio" ||
        song.status === "saving"
      ) {
        await ctx.db.patch(song._id, { status: "metadata_ready" })
      }
    }
  },
})

export const retryErroredSong = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song || song.status !== "retry_pending") return
    const revertTo = song.erroredAtStatus === "generating_metadata" ? "pending" : "metadata_ready"
    await ctx.db.patch(args.id, {
      status: revertTo,
      retryCount: (song.retryCount || 0) + 1,
      errorMessage: undefined,
      erroredAtStatus: undefined,
    })
  },
})

// Smart recovery: preserves generating_audio (has aceTaskId), reverts others
export const recoverFromWorkerRestart = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()

    let recovered = 0
    for (const song of songs) {
      if (song.status === "generating_metadata") {
        // LLM work lost, redo from pending
        await ctx.db.patch(song._id, { status: "pending" })
        recovered++
      } else if (song.status === "submitting_to_ace") {
        // ACE submission lost, redo from metadata_ready
        await ctx.db.patch(song._id, { status: "metadata_ready" })
        recovered++
      } else if (song.status === "saving") {
        // Audio exists on ACE, re-poll to re-trigger save
        await ctx.db.patch(song._id, { status: "generating_audio" })
        recovered++
      }
      // generating_audio stays — will resume polling with persisted aceTaskId
    }
    return recovered
  },
})

// Revert a single song from generating_audio back to metadata_ready (ACE task lost)
export const revertToMetadataReady = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    await ctx.db.patch(args.id, {
      status: "metadata_ready",
      aceTaskId: undefined,
      aceSubmittedAt: undefined,
      aceAudioPath: undefined,
    })
  },
})

// ─── Worker queries ─────────────────────────────────────────────────

export const getWorkQueue = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()

    const pending = songs.filter((s) => s.status === "pending").sort((a, b) => a.orderIndex - b.orderIndex)
    const metadataReady = songs.filter((s) => s.status === "metadata_ready").sort((a, b) => a.orderIndex - b.orderIndex)
    const needsCover = songs.filter((s) => s.coverPrompt && !s.coverUrl && s.status !== "pending" && s.status !== "generating_metadata" && s.status !== "error")
    const generatingAudio = songs.filter((s) => s.status === "generating_audio")
    const retryPending = songs.filter((s) => s.status === "retry_pending")

    // Calculate buffer deficit
    const activeStatuses = ["pending", "generating_metadata", "metadata_ready", "submitting_to_ace", "generating_audio", "saving", "ready"]
    const activeSongs = songs.filter((s) => activeStatuses.includes(s.status))
    const playedOrPlaying = songs.filter((s) => s.status === "played" || s.status === "playing")
    const bufferDeficit = Math.max(0, 5 - (activeSongs.length - playedOrPlaying.length))

    const maxOrderIndex = songs.length > 0 ? Math.max(...songs.map((s) => s.orderIndex)) : 0

    // Count all songs in non-terminal statuses (for closing detection)
    const transientStatuses = ["pending", "generating_metadata", "metadata_ready", "submitting_to_ace", "generating_audio", "saving", "retry_pending"]
    const transientCount = songs.filter((s) => transientStatuses.includes(s.status)).length

    return {
      pending,
      metadataReady,
      needsCover,
      generatingAudio,
      retryPending,
      bufferDeficit,
      maxOrderIndex,
      totalSongs: songs.length,
      transientCount,
    }
  },
})
