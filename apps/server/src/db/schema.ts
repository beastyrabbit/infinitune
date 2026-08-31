import { createId } from "@paralleldrive/cuid2";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

// ─── Users ──────────────────────────────────────────────────────────

export const users = sqliteTable(
	"users",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		shooSubject: text("shoo_subject").notNull().unique(),
		displayName: text("display_name"),
		email: text("email"),
		picture: text("picture"),
		lastSeenAt: integer("last_seen_at", { mode: "number" }),
	},
	(table) => [index("users_by_shoo_subject").on(table.shooSubject)],
);

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
		aceModel: text("ace_model"),
		aceDcwEnabled: integer("ace_dcw_enabled", { mode: "boolean" }),
		aceDcwMode: text("ace_dcw_mode"),
		aceDcwScaler: real("ace_dcw_scaler"),
		aceDcwHighScaler: real("ace_dcw_high_scaler"),
		aceDcwWavelet: text("ace_dcw_wavelet"),
		currentOrderIndex: real("current_order_index"),
		lastSeenAt: integer("last_seen_at", { mode: "number" }),
		promptEpoch: integer("prompt_epoch").default(0),
		steerHistory: text("steer_history"),
		managerBrief: text("manager_brief"),
		managerPlan: text("manager_plan"),
		managerEpoch: integer("manager_epoch"),
		managerUpdatedAt: integer("manager_updated_at", { mode: "number" }),
		isStarred: integer("is_starred", { mode: "boolean" }).default(false),
		ownerUserId: text("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		isTemporary: integer("is_temporary", { mode: "boolean" })
			.notNull()
			.default(false),
		expiresAt: integer("expires_at", { mode: "number" }),
		aceThinking: integer("ace_thinking", { mode: "boolean" }),
		aceAutoDuration: integer("ace_auto_duration", { mode: "boolean" }),
		description: text("description"),
		descriptionUpdatedAt: integer("description_updated_at", {
			mode: "number",
		}),
	},
	(table) => [
		index("playlists_by_playlist_key").on(table.playlistKey),
		index("playlists_by_owner_user_id").on(table.ownerUserId),
		index("playlists_by_is_temporary").on(table.isTemporary),
	],
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
		coverWebpUrl: text("cover_webp_url"),
		coverJxlUrl: text("cover_jxl_url"),
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
		// Reimagine (ACE "cover" task): re-render sourceSongId in a new style
		aceTaskType: text("ace_task_type"),
		sourceSongId: text("source_song_id"),
		// External reference audio (e.g. YouTube download) for cover tasks
		sourceAudioPath: text("source_audio_path"),
		// Pending source spec the worker resolves to a file before ACE submit:
		// a direct URL or a "ytsearchN:" query for yt-dlp
		sourceUrl: text("source_url"),
		coverNoiseStrength: real("cover_noise_strength"),
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
		albumId: text("album_id"),
		albumTrackNumber: integer("album_track_number"),
		radioEligible: integer("radio_eligible", { mode: "boolean" })
			.notNull()
			.default(false),
		likeCount: integer("like_count").notNull().default(0),
		dislikeCount: integer("dislike_count").notNull().default(0),
		skipCount: integer("skip_count").notNull().default(0),
		radioPlayCount: integer("radio_play_count").notNull().default(0),
		lastRadioPlayedAt: integer("last_radio_played_at", { mode: "number" }),
		requestId: text("request_id"),
	},
	(table) => [
		index("songs_by_playlist").on(table.playlistId),
		index("songs_by_playlist_status").on(table.playlistId, table.status),
		index("songs_by_playlist_order").on(table.playlistId, table.orderIndex),
		index("songs_by_user_rating").on(table.userRating),
		index("songs_by_album").on(table.albumId, table.albumTrackNumber),
		index("songs_by_radio_eligible_status").on(
			table.radioEligible,
			table.status,
		),
	],
);

// ─── Global Radio ───────────────────────────────────────────────────

export const radioStations = sqliteTable("radio_stations", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at", { mode: "number" })
		.notNull()
		.$defaultFn(() => Date.now()),
	updatedAt: integer("updated_at", { mode: "number" })
		.notNull()
		.$defaultFn(() => Date.now()),
	currentSongId: text("current_song_id").references(() => songs.id, {
		onDelete: "set null",
	}),
	currentPlayId: text("current_play_id"),
	startedAt: integer("started_at", { mode: "number" }),
	pausedAt: integer("paused_at", { mode: "number" }),
	pausedOffsetMs: integer("paused_offset_ms").notNull().default(0),
	isPlaying: integer("is_playing", { mode: "boolean" })
		.notNull()
		.default(false),
	activeListenerCount: integer("active_listener_count").notNull().default(0),
	scheduleVersion: integer("schedule_version").notNull().default(0),
	inventoryTarget: integer("inventory_target").notNull().default(10),
});

export const albums = sqliteTable(
	"albums",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		title: text("title").notNull(),
		bandName: text("band_name"),
		theme: text("theme").notNull(),
		status: text("status").notNull().default("generating"),
		generationKind: text("generation_kind").notNull().default("default"),
		coverPrompt: text("cover_prompt"),
		coverUrl: text("cover_url"),
		coverWebpUrl: text("cover_webp_url"),
		coverJxlUrl: text("cover_jxl_url"),
		trendResearchJson: text("trend_research_json"),
		bandPersonaJson: text("band_persona_json"),
		vocalPlanJson: text("vocal_plan_json"),
		requestId: text("request_id"),
		firstPlayedAt: integer("first_played_at", { mode: "number" }),
		readyAt: integer("ready_at", { mode: "number" }),
		completedAt: integer("completed_at", { mode: "number" }),
	},
	(table) => [
		index("albums_by_status_first_played").on(
			table.status,
			table.firstPlayedAt,
		),
		index("albums_by_generation_kind").on(table.generationKind),
	],
);

export const radioPlays = sqliteTable(
	"radio_plays",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		songId: text("song_id")
			.notNull()
			.references(() => songs.id, { onDelete: "cascade" }),
		albumId: text("album_id").references(() => albums.id, {
			onDelete: "set null",
		}),
		startedAt: integer("started_at", { mode: "number" }).notNull(),
		endedAt: integer("ended_at", { mode: "number" }),
		completed: integer("completed", { mode: "boolean" })
			.notNull()
			.default(false),
		skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
		listenerCountSnapshot: integer("listener_count_snapshot")
			.notNull()
			.default(0),
	},
	(table) => [
		index("radio_plays_by_started").on(table.startedAt),
		index("radio_plays_by_song").on(table.songId),
		index("radio_plays_by_album").on(table.albumId),
	],
);

export const radioSchedule = sqliteTable(
	"radio_schedule",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		stationId: text("station_id")
			.notNull()
			.references(() => radioStations.id, { onDelete: "cascade" }),
		slotIndex: integer("slot_index").notNull(),
		songId: text("song_id")
			.notNull()
			.references(() => songs.id, { onDelete: "cascade" }),
		reason: text("reason").notNull(),
		score: real("score").notNull().default(0),
		locked: integer("locked", { mode: "boolean" }).notNull().default(false),
		isRequest: integer("is_request", { mode: "boolean" })
			.notNull()
			.default(false),
		scheduleVersion: integer("schedule_version").notNull(),
	},
	(table) => [
		index("radio_schedule_by_station_slot").on(
			table.stationId,
			table.slotIndex,
		),
		index("radio_schedule_by_version").on(table.scheduleVersion),
	],
);

// User-seeded source URLs for the cover-first radio: each row is one
// external track the album planner can claim as cover reference audio.
export const coverSources = sqliteTable(
	"cover_sources",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		url: text("url").notNull(),
		genreTag: text("genre_tag"),
		status: text("status", { enum: ["pending", "used", "failed"] })
			.notNull()
			.default("pending"),
		lastUsedAt: integer("last_used_at", { mode: "number" }),
		resolvedAudioPath: text("resolved_audio_path"),
	},
	(table) => [index("cover_sources_by_status").on(table.status)],
);

export const radioRequests = sqliteTable(
	"radio_requests",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		prompt: text("prompt").notNull(),
		kind: text("kind").notNull().default("auto"),
		status: text("status").notNull().default("pending"),
		matchedSongId: text("matched_song_id"),
		albumId: text("album_id"),
		targetSongId: text("target_song_id"),
		scheduleSlot: integer("schedule_slot"),
		notificationState: text("notification_state"),
	},
	(table) => [
		index("radio_requests_by_status").on(table.status),
		index("radio_requests_by_kind").on(table.kind),
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

// ─── Devices ────────────────────────────────────────────────────────

export const devices = sqliteTable(
	"devices",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		ownerUserId: text("owner_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		name: text("name").notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		status: text("status").notNull().default("active"),
		lastSeenAt: integer("last_seen_at", { mode: "number" }),
		capabilities: text("capabilities"),
		daemonVersion: text("daemon_version"),
	},
	(table) => [
		index("devices_by_owner_user_id").on(table.ownerUserId),
		index("devices_by_status").on(table.status),
	],
);

export const playlistDeviceAssignments = sqliteTable(
	"playlist_device_assignments",
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
		deviceId: text("device_id")
			.notNull()
			.references(() => devices.id, { onDelete: "cascade" }),
		assignedByUserId: text("assigned_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		assignedAt: integer("assigned_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	},
	(table) => [
		index("playlist_device_assignments_by_playlist").on(table.playlistId),
		index("playlist_device_assignments_by_device").on(table.deviceId),
		index("playlist_device_assignments_by_active").on(table.isActive),
	],
);

// ─── Agent Channel ─────────────────────────────────────────────────────

export const agentChannelMessages = sqliteTable(
	"agent_channel_messages",
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
		threadId: text("thread_id"),
		senderKind: text("sender_kind").notNull(),
		senderId: text("sender_id").notNull(),
		messageType: text("message_type").notNull(),
		visibility: text("visibility").notNull().default("public"),
		content: text("content").notNull(),
		dataJson: text("data_json"),
		correlationId: text("correlation_id"),
	},
	(table) => [
		index("agent_channel_messages_by_playlist").on(
			table.playlistId,
			table.createdAt,
		),
		index("agent_channel_messages_by_thread").on(
			table.playlistId,
			table.threadId,
		),
		index("agent_channel_messages_by_correlation").on(table.correlationId),
	],
);

export const agentMemoryEntries = sqliteTable(
	"agent_memory_entries",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		scope: text("scope").notNull(),
		playlistId: text("playlist_id").references(() => playlists.id, {
			onDelete: "cascade",
		}),
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		contentJson: text("content_json").notNull(),
		confidence: real("confidence").notNull().default(0.5),
		importance: real("importance").notNull().default(0.5),
		useCount: integer("use_count").notNull().default(0),
		lastUsedAt: integer("last_used_at", { mode: "number" }),
		expiresAt: integer("expires_at", { mode: "number" }),
		deletedAt: integer("deleted_at", { mode: "number" }),
	},
	(table) => [
		index("agent_memory_entries_by_scope").on(table.scope, table.playlistId),
		index("agent_memory_entries_by_kind").on(table.kind),
		index("agent_memory_entries_by_deleted").on(table.deletedAt),
	],
);

export const agentRuns = sqliteTable(
	"agent_runs",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		playlistId: text("playlist_id").references(() => playlists.id, {
			onDelete: "cascade",
		}),
		agentId: text("agent_id").notNull(),
		sessionKey: text("session_key"),
		trigger: text("trigger").notNull(),
		status: text("status").notNull(),
		inputJson: text("input_json"),
		outputJson: text("output_json"),
		error: text("error"),
	},
	(table) => [
		index("agent_runs_by_playlist").on(table.playlistId, table.createdAt),
		index("agent_runs_by_agent").on(table.agentId, table.createdAt),
	],
);

// ─── Station presets & share links ──────────────────────────────────

export const radioStationPresets = sqliteTable(
	"radio_station_presets",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		updatedAt: integer("updated_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		name: text("name").notNull(),
		description: text("description"),
		genrePrompt: text("genre_prompt").notNull(),
		vocalStyle: text("vocal_style"),
		isActive: integer("is_active", { mode: "boolean" })
			.notNull()
			.default(false),
	},
	(table) => [index("radio_station_presets_by_active").on(table.isActive)],
);

export const shareLinks = sqliteTable(
	"share_links",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		createdAt: integer("created_at", { mode: "number" })
			.notNull()
			.$defaultFn(() => Date.now()),
		token: text("token").notNull().unique(),
		resourceType: text("resource_type").notNull(),
		resourceId: text("resource_id").notNull(),
		expiresAt: integer("expires_at", { mode: "number" }),
		revokedAt: integer("revoked_at", { mode: "number" }),
	},
	(table) => [
		index("share_links_by_resource").on(table.resourceType, table.resourceId),
	],
);

// ─── Type exports ───────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;
export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type RadioStation = typeof radioStations.$inferSelect;
export type NewRadioStation = typeof radioStations.$inferInsert;
export type RadioPlay = typeof radioPlays.$inferSelect;
export type NewRadioPlay = typeof radioPlays.$inferInsert;
export type RadioSchedule = typeof radioSchedule.$inferSelect;
export type NewRadioSchedule = typeof radioSchedule.$inferInsert;
export type RadioRequest = typeof radioRequests.$inferSelect;
export type NewRadioRequest = typeof radioRequests.$inferInsert;
export type CoverSource = typeof coverSources.$inferSelect;
export type NewCoverSource = typeof coverSources.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type PlaylistDeviceAssignment =
	typeof playlistDeviceAssignments.$inferSelect;
export type NewPlaylistDeviceAssignment =
	typeof playlistDeviceAssignments.$inferInsert;
export type AgentChannelMessage = typeof agentChannelMessages.$inferSelect;
export type NewAgentChannelMessage = typeof agentChannelMessages.$inferInsert;
export type AgentMemoryEntry = typeof agentMemoryEntries.$inferSelect;
export type NewAgentMemoryEntry = typeof agentMemoryEntries.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type RadioStationPreset = typeof radioStationPresets.$inferSelect;
export type NewRadioStationPreset = typeof radioStationPresets.$inferInsert;
export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;
