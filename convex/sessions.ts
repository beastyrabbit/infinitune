import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { llmProviderValidator, sessionModeValidator, sessionStatusValidator } from './types'

export const get = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const getCurrent = query({
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").collect()
    // Show both 'active' and 'closing' sessions — closing stays visible until done
    // Exclude oneshot sessions — they have their own UI
    const active = sessions.filter((s) =>
      (s.status === "active" || s.status === "closing") && s.mode !== "oneshot"
    )
    return active[active.length - 1] ?? null
  },
})

export const listClosed = query({
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").collect()
    return sessions.filter((s) =>
      (s.status === "closed" || s.status === "closing") && s.mode !== "oneshot"
    ).reverse()
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
    llmProvider: llmProviderValidator,
    llmModel: v.string(),
    mode: v.optional(sessionModeValidator),
    lyricsLanguage: v.optional(v.string()),
    targetBpm: v.optional(v.number()),
    targetKey: v.optional(v.string()),
    timeSignature: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    inferenceSteps: v.optional(v.number()),
    lmTemperature: v.optional(v.number()),
    lmCfgScale: v.optional(v.number()),
    inferMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      ...args,
      mode: args.mode ?? "endless",
      status: "active",
      songsGenerated: 0,
    })
  },
})

export const updateParams = mutation({
  args: {
    id: v.id("sessions"),
    lyricsLanguage: v.optional(v.string()),
    targetBpm: v.optional(v.number()),
    targetKey: v.optional(v.string()),
    timeSignature: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    inferenceSteps: v.optional(v.number()),
    lmTemperature: v.optional(v.number()),
    lmCfgScale: v.optional(v.number()),
    inferMethod: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...params } = args
    // Only patch fields that were actually provided
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        patch[key] = value
      }
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(id, patch)
    }
  },
})

export const updateStatus = mutation({
  args: {
    id: v.id("sessions"),
    status: sessionStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status })
  },
})

export const updateCurrentPosition = mutation({
  args: {
    id: v.id("sessions"),
    currentOrderIndex: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { currentOrderIndex: args.currentOrderIndex })
  },
})

export const incrementSongsGenerated = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id)
    if (!session) throw new Error("Session not found")
    await ctx.db.patch(args.id, { songsGenerated: session.songsGenerated + 1 })
  },
})

export const resetDefaults = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      lyricsLanguage: undefined,
      targetBpm: undefined,
      targetKey: undefined,
      timeSignature: undefined,
      audioDuration: undefined,
      inferenceSteps: undefined,
      lmTemperature: undefined,
      lmCfgScale: undefined,
      inferMethod: undefined,
    })
  },
})

export const updatePrompt = mutation({
  args: {
    id: v.id("sessions"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { prompt: args.prompt })
  },
})

export const remove = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, args) => {
    // Delete all songs in this session first
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.id))
      .collect()
    for (const song of songs) {
      await ctx.db.delete(song._id)
    }
    await ctx.db.delete(args.id)
  },
})

export const listAll = query({
  handler: async (ctx) => {
    return await ctx.db.query("sessions").collect()
  },
})

// Returns sessions that the worker should process (active + closing)
export const listWorkerSessions = query({
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").collect()
    return sessions.filter((s) => s.status === "active" || s.status === "closing")
  },
})
