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
    // Return songs sorted by orderIndex, with their status
    return songs.sort((a, b) => a.orderIndex - b.orderIndex)
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
    const isCancelled = args.errorMessage === 'Cancelled by user'
    const canRetry = !isCancelled && retryCount < 3
    await ctx.db.patch(args.id, {
      status: canRetry ? "retry_pending" : "error",
      errorMessage: args.errorMessage,
      erroredAtStatus: args.erroredAtStatus || song.status,
      ...(isCancelled ? { cancelledAtStatus: args.erroredAtStatus || song.status } : {}),
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

export const cancelAllGenerating = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    const activeStatuses = [
      "generating_metadata",
      "generating_cover",
      "submitting_to_ace",
      "generating_audio",
      "saving",
    ]
    for (const song of songs) {
      if (activeStatuses.includes(song.status)) {
        await ctx.db.patch(song._id, {
          status: "error",
          errorMessage: "Cancelled by user",
          cancelledAtStatus: song.status,
        })
      }
    }
  },
})

export const getCancelledForResume = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    return songs.filter(
      (s) => s.status === "error" && s.errorMessage === "Cancelled by user" && s.cancelledAtStatus,
    )
  },
})

export const markResuming = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    // Reset to submitting_to_ace — we'll redo from ACE submission
    await ctx.db.patch(args.id, {
      status: "submitting_to_ace",
      errorMessage: undefined,
      cancelledAtStatus: undefined,
      generationStartedAt: Date.now(),
    })
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

export const getRetryPending = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const songs = await ctx.db.query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect()
    return songs.filter((s) => s.status === "retry_pending")
      .sort((a, b) => a.orderIndex - b.orderIndex)
  },
})

export const markRetrying = mutation({
  args: {
    id: v.id("songs"),
    newOrderIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    await ctx.db.patch(args.id, {
      status: "submitting_to_ace",
      orderIndex: args.newOrderIndex,
      retryCount: (song.retryCount || 0) + 1,
      errorMessage: undefined,
      erroredAtStatus: undefined,
      generationStartedAt: Date.now(),
    })
  },
})
