import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { llmProviderValidator, playlistModeValidator, playlistStatusValidator } from './types'

export const get = query({
  args: { id: v.id("playlists") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const getByPlaylistKey = query({
  args: { playlistKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("playlists")
      .withIndex("by_playlist_key", (q) => q.eq("playlistKey", args.playlistKey))
      .first()
  },
})

export const getCurrent = query({
  handler: async (ctx) => {
    const playlists = await ctx.db.query("playlists").collect()
    // Show both 'active' and 'closing' playlists — closing stays visible until done
    // Exclude oneshot playlists — they have their own UI
    const active = playlists.filter((s) =>
      (s.status === "active" || s.status === "closing") && s.mode !== "oneshot"
    )
    return active[active.length - 1] ?? null
  },
})

export const listClosed = query({
  handler: async (ctx) => {
    const playlists = await ctx.db.query("playlists").collect()
    return playlists.filter((s) =>
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
    mode: v.optional(playlistModeValidator),
    playlistKey: v.optional(v.string()),
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
    return await ctx.db.insert("playlists", {
      ...args,
      mode: args.mode ?? "endless",
      status: "active",
      songsGenerated: 0,
      promptEpoch: 0,
    })
  },
})

export const updateParams = mutation({
  args: {
    id: v.id("playlists"),
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
    id: v.id("playlists"),
    status: playlistStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status })
  },
})

export const updateCurrentPosition = mutation({
  args: {
    id: v.id("playlists"),
    currentOrderIndex: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { currentOrderIndex: args.currentOrderIndex })
  },
})

export const incrementSongsGenerated = mutation({
  args: { id: v.id("playlists") },
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.id)
    if (!playlist) throw new Error("Playlist not found")
    await ctx.db.patch(args.id, { songsGenerated: playlist.songsGenerated + 1 })
  },
})

export const resetDefaults = mutation({
  args: { id: v.id("playlists") },
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
    id: v.id("playlists"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.id)
    if (!playlist) throw new Error("Playlist not found")
    const newEpoch = (playlist.promptEpoch ?? 0) + 1
    const history = playlist.steerHistory ?? []
    history.push({ epoch: newEpoch, direction: args.prompt, at: Date.now() })
    await ctx.db.patch(args.id, {
      prompt: args.prompt,
      promptEpoch: newEpoch,
      steerHistory: history,
    })
  },
})

export const remove = mutation({
  args: { id: v.id("playlists") },
  handler: async (ctx, args) => {
    // Delete all songs in this playlist first
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.id))
      .collect()
    for (const song of songs) {
      await ctx.db.delete(song._id)
    }
    await ctx.db.delete(args.id)
  },
})

export const listAll = query({
  handler: async (ctx) => {
    return await ctx.db.query("playlists").collect()
  },
})

export const updateHeartbeat = mutation({
  args: { id: v.id("playlists") },
  handler: async (ctx, args) => {
    const playlist = await ctx.db.get(args.id)
    if (!playlist) return
    const now = Date.now()
    const patch: Record<string, unknown> = {}
    // Only update if new value is greater (supports multiple listeners)
    if (!playlist.lastSeenAt || now > playlist.lastSeenAt) {
      patch.lastSeenAt = now
    }
    // Re-activate closing/closed playlists when user returns
    // (user-initiated close navigates away, so no heartbeats — this only
    // fires when someone is actually viewing the playlist page)
    if (playlist.status === 'closing' || playlist.status === 'closed') {
      patch.status = 'active'
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch)
    }
  },
})

// Returns playlists that the worker should process (active + closing)
export const listWorkerPlaylists = query({
  handler: async (ctx) => {
    const playlists = await ctx.db.query("playlists").collect()
    return playlists.filter((s) => s.status === "active" || s.status === "closing")
  },
})
