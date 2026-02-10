import { v } from 'convex/values'
import { query, mutation } from './_generated/server'

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("sessions").collect()
  },
})

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
    const active = sessions.filter((s) => s.status === "active" || s.status === "closing")
    return active[active.length - 1] ?? null
  },
})

export const listClosed = query({
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").collect()
    return sessions.filter((s) => s.status === "closed" || s.status === "closing").reverse()
  },
})

export const create = mutation({
  args: {
    name: v.string(),
    prompt: v.string(),
    llmProvider: v.string(),
    llmModel: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      ...args,
      status: "active",
      songsGenerated: 0,
    })
  },
})

export const updateStatus = mutation({
  args: {
    id: v.id("sessions"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status })
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
