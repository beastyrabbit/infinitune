import { createId } from "@paralleldrive/cuid2";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

// ─── Playlists ──────────────────────────────────────────────────────

export const playlists = sqliteTable(
	"playlists",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),

		name: text("name").notNull(),
		prompt: text("prompt").notNull(),
		llmProvider: text("llm_provider").notNull(),
		llmModel: text("llm_model").notNull(),
		mode: text("mode").notNull().default("endless"),
		status: text("status").notNull().default("active"),
		songsGenerated: integer("songs_generated").notNull().default(0),
		playlistKey: text("playlist_key"),
		lyricsLanguage: text("lyrics_language"),
		targetBpm: real("target_bpm"),
		targetKey: text("target_key"),
		timeSignature: text("time_signature"),
		audioDuration: real("audio_duration"),
		inferenceSteps: integer("inference_steps"),
		lmTemperature: real("lm_temperature"),
		lmCfgScale: real("lm_cfg_scale"),
		inferMethod: text("infer_method"),
		currentOrderIndex: real("current_order_index"),
		lastSeenAt: integer("last_seen_at", { mode: "number" }),
		promptEpoch: integer("prompt_epoch").default(0),
		steerHistory: text("steer_history"),
		isStarred: integer("is_starred", { mode: "boolean" }).default(false),
	},
	(table) => [index("playlists_by_playlist_key").on(table.playlistKey)],
);

// ─── Songs ──────────────────────────────────────────────────────────

export const songs = sqliteTable(
	"songs",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),

		playlistId: text("playlist_id")
			.notNull()
			.references(() => playlists.id, { onDelete: "cascade" }),
		orderIndex: real("order_index").notNull(),

		// Metadata
		title: text("title"),
		artistName: text("artist_name"),
		genre: text("genre"),
		subGenre: text("sub_genre"),
		lyrics: text("lyrics"),
		caption: text("caption"),
		coverPrompt: text("cover_prompt"),
		coverUrl: text("cover_url"),
		bpm: real("bpm"),
		keyScale: text("key_scale"),
		timeSignature: text("time_signature"),
		audioDuration: real("audio_duration"),
		vocalStyle: text("vocal_style"),
		mood: text("mood"),
		energy: text("energy"),
		era: text("era"),
		instruments: text("instruments"),
		tags: text("tags"),
		themes: text("themes"),
		language: text("language"),
		description: text("description"),

		// Status & processing
		status: text("status").notNull().default("pending"),
		aceTaskId: text("ace_task_id"),
		aceSubmittedAt: integer("ace_submitted_at", { mode: "number" }),
		audioUrl: text("audio_url"),
		storagePath: text("storage_path"),
		aceAudioPath: text("ace_audio_path"),
		errorMessage: text("error_message"),
		retryCount: integer("retry_count").default(0),
		erroredAtStatus: text("errored_at_status"),
		cancelledAtStatus: text("cancelled_at_status"),
		generationStartedAt: integer("generation_started_at", {
			mode: "number",
		}),
		generationCompletedAt: integer("generation_completed_at", {
			mode: "number",
		}),

		// Flags
		isInterrupt: integer("is_interrupt", { mode: "boolean" }),
		interruptPrompt: text("interrupt_prompt"),
		llmProvider: text("llm_provider"),
		llmModel: text("llm_model"),
		promptEpoch: integer("prompt_epoch"),
		userRating: text("user_rating"),
		playDurationMs: integer("play_duration_ms"),
		listenCount: integer("listen_count").default(0),

		// Timing metrics
		metadataProcessingMs: integer("metadata_processing_ms"),
		coverProcessingMs: integer("cover_processing_ms"),
		audioProcessingMs: integer("audio_processing_ms"),
		personaExtract: text("persona_extract"),
	},
	(table) => [
		index("songs_by_playlist").on(table.playlistId),
		index("songs_by_playlist_status").on(table.playlistId, table.status),
		index("songs_by_playlist_order").on(table.playlistId, table.orderIndex),
		index("songs_by_user_rating").on(table.userRating),
	],
);

// ─── Settings ───────────────────────────────────────────────────────

export const settings = sqliteTable(
	"settings",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),

		key: text("key").notNull().unique(),
		value: text("value").notNull(),
	},
	(table) => [index("settings_by_key").on(table.key)],
);

// ─── Type exports ───────────────────────────────────────────────────

export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;
export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type Setting = typeof settings.$inferSelect;
