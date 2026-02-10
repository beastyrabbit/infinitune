import { v } from 'convex/values'
import { query, mutation } from './_generated/server'

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first()
    return setting?.value ?? null
  },
})

export const getAll = query({
  handler: async (ctx) => {
    const settings = await ctx.db.query("settings").collect()
    return Object.fromEntries(settings.map((s) => [s.key, s.value]))
  },
})

export const set = mutation({
  args: {
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value })
    } else {
      await ctx.db.insert("settings", { key: args.key, value: args.value })
    }
  },
})
