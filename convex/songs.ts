import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { songStatusValidator, llmProviderValidator, ACTIVE_STATUSES, TRANSIENT_STATUSES } from './types'

export const listByPlaylist = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("songs")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .collect()
  },
})

export const getQueue = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
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
    playlistId: v.id("playlists"),
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
    vocalStyle: v.optional(v.string()),
    mood: v.optional(v.string()),
    energy: v.optional(v.string()),
    era: v.optional(v.string()),
    instruments: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    themes: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    description: v.optional(v.string()),
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
    vocalStyle: v.optional(v.string()),
    mood: v.optional(v.string()),
    energy: v.optional(v.string()),
    era: v.optional(v.string()),
    instruments: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    themes: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...metadata } = args
    await ctx.db.patch(id, metadata)
  },
})

export const updateStatus = mutation({
  args: {
    id: v.id("songs"),
    status: songStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status }
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
    erroredAtStatus: v.optional(songStatusValidator),
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

export const setRating = mutation({
  args: {
    id: v.id("songs"),
    rating: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    // Toggle: if same rating clicked again, clear it
    const newRating = song.userRating === args.rating ? undefined : args.rating
    await ctx.db.patch(args.id, { userRating: newRating })
  },
})

export const addListen = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    await ctx.db.patch(args.id, { listenCount: (song.listenCount || 0) + 1 })
  },
})

export const addPlayDuration = mutation({
  args: {
    id: v.id("songs"),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    await ctx.db.patch(args.id, {
      playDurationMs: (song.playDurationMs || 0) + args.durationMs,
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
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist_order", (q) => q.eq("playlistId", args.playlistId))
      .collect()
    if (songs.length === 0) return 1
    const maxOrder = Math.max(...songs.map((s) => s.orderIndex))
    return Math.ceil(maxOrder) + 1
  },
})

export const listAll = query({
  handler: async (ctx) => {
    const songs = await ctx.db.query("songs").collect()
    const withMetadata = songs.filter((s) => s.title)
    const resolved = await Promise.all(
      withMetadata.map(async (song) => {
        if (song.coverStorageId && !song.coverUrl) {
          const url = await ctx.storage.getUrl(song.coverStorageId)
          return { ...song, coverUrl: url ?? undefined }
        }
        return song
      })
    )
    return resolved.sort((a, b) => b._creationTime - a._creationTime)
  },
})

// ─── Worker mutations ───────────────────────────────────────────────

export const createPending = mutation({
  args: {
    playlistId: v.id("playlists"),
    orderIndex: v.number(),
    isInterrupt: v.optional(v.boolean()),
    interruptPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("songs", {
      playlistId: args.playlistId,
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
    vocalStyle: v.optional(v.string()),
    mood: v.optional(v.string()),
    energy: v.optional(v.string()),
    era: v.optional(v.string()),
    instruments: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    themes: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    description: v.optional(v.string()),
    llmProvider: v.optional(llmProviderValidator),
    llmModel: v.optional(v.string()),
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
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
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
      generationStartedAt: Date.now(),
    })
  },
})

export const deleteSong = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
  },
})

export const revertSingleSong = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, args) => {
    const song = await ctx.db.get(args.id)
    if (!song) return
    if (song.status === "generating_metadata") {
      await ctx.db.patch(args.id, { status: "pending", generationStartedAt: Date.now() })
    } else if (
      song.status === "submitting_to_ace" ||
      song.status === "generating_audio" ||
      song.status === "saving"
    ) {
      await ctx.db.patch(args.id, {
        status: "metadata_ready",
        aceTaskId: undefined,
        aceSubmittedAt: undefined,
        generationStartedAt: Date.now(),
      })
    }
  },
})

// Smart recovery: preserves generating_audio (has aceTaskId), reverts others
export const recoverFromWorkerRestart = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
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
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_playlist", (q) => q.eq("playlistId", args.playlistId))
      .collect()

    const pending = songs.filter((s) => s.status === "pending").sort((a, b) => a.orderIndex - b.orderIndex)
    const metadataReady = songs.filter((s) => s.status === "metadata_ready").sort((a, b) => a.orderIndex - b.orderIndex)
    const needsCover = songs.filter((s) => s.coverPrompt && !s.coverUrl && s.status !== "pending" && s.status !== "generating_metadata" && s.status !== "error")
    const generatingAudio = songs.filter((s) => s.status === "generating_audio")
    const retryPending = songs.filter((s) => s.status === "retry_pending")

    // Calculate buffer deficit based on current playing position
    const playlist = await ctx.db.get(args.playlistId)
    const currentOrderIndex = playlist?.currentOrderIndex ?? 0
    const songsAhead = songs.filter((s) =>
      s.orderIndex > currentOrderIndex &&
      (ACTIVE_STATUSES as string[]).includes(s.status)
    ).length
    const bufferDeficit = Math.max(0, 5 - songsAhead)

    const maxOrderIndex = songs.length > 0 ? Math.max(...songs.map((s) => s.orderIndex)) : 0

    // Count all songs in non-terminal statuses (for closing detection)
    const transientCount = songs.filter((s) => (TRANSIENT_STATUSES as string[]).includes(s.status)).length

    // Songs with metadata, most recent first
    const completedSongs = songs
      .filter((s) => s.title && s.status !== "pending" && s.status !== "generating_metadata")
      .sort((a, b) => b.orderIndex - a.orderIndex)

    // Last 5 full songs for diversity prompt (genre, vocal, mood details)
    const recentCompleted = completedSongs
      .slice(0, 5)
      .map((s) => ({
        title: s.title!,
        artistName: s.artistName!,
        genre: s.genre!,
        subGenre: s.subGenre!,
        vocalStyle: s.vocalStyle,
        mood: s.mood,
        energy: s.energy,
      }))

    // Last 20 short descriptions for thematic diversity
    const recentDescriptions = completedSongs
      .slice(0, 20)
      .map((s) => s.description)
      .filter((d): d is string => !!d)

    // Detect stale songs stuck in actively-processing statuses (not waiting statuses)
    const STALE_TIMEOUT_MS = 20 * 60 * 1000 // 20 minutes
    const ACTIVE_PROCESSING_STATUSES = ["generating_metadata", "submitting_to_ace", "generating_audio", "saving"]
    const now = Date.now()
    const staleSongs = songs.filter((s) => {
      if (!ACTIVE_PROCESSING_STATUSES.includes(s.status)) return false
      if (s.status === "generating_audio") {
        const audioStart = s.aceSubmittedAt || s.generationStartedAt || s._creationTime
        return (now - audioStart) > STALE_TIMEOUT_MS
      }
      const startedAt = s.generationStartedAt || s._creationTime
      return (now - startedAt) > STALE_TIMEOUT_MS
    })

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
      recentCompleted,
      recentDescriptions,
      staleSongs: staleSongs.map((s) => ({ _id: s._id, status: s.status, title: s.title })),
    }
  },
})
