import { logger } from "../logger";
import { sqlite } from "./index";

/**
 * Idempotent ALTER TABLE ADD COLUMN — silently ignores "duplicate column" errors.
 * Rethrows any other error.
 */
function addColumn(table: string, columnDef: string): void {
	try {
		sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			const colName = columnDef.split(/\s+/)[0];
			logger.error({ err }, `Failed to add ${colName} column to ${table}`);
			throw err;
		}
	}
}

/**
 * Auto-create tables on startup using raw SQL (no migration files needed).
 * Idempotent — safe to call on every startup.
 *
 * Uses raw DDL instead of drizzle-kit migrations because this is a local-only
 * app with no production deployments to manage. `CREATE TABLE IF NOT EXISTS`
 * is sufficient. If schema versioning becomes needed, switch to drizzle-kit push/migrate.
 */
export function ensureSchema() {
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			shoo_subject TEXT NOT NULL UNIQUE,
			display_name TEXT,
			email TEXT,
			picture TEXT,
			last_seen_at INTEGER
		);

		CREATE INDEX IF NOT EXISTS users_by_shoo_subject ON users(shoo_subject);

		CREATE TABLE IF NOT EXISTS playlists (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			name TEXT NOT NULL,
			prompt TEXT NOT NULL,
			llm_provider TEXT NOT NULL,
			llm_model TEXT NOT NULL,
			mode TEXT NOT NULL DEFAULT 'endless',
			status TEXT NOT NULL DEFAULT 'active',
			songs_generated INTEGER NOT NULL DEFAULT 0,
			playlist_key TEXT,
			lyrics_language TEXT,
			target_bpm REAL,
			target_key TEXT,
			time_signature TEXT,
			audio_duration REAL,
			inference_steps INTEGER,
			lm_temperature REAL,
			lm_cfg_scale REAL,
			infer_method TEXT,
			ace_model TEXT,
			ace_dcw_enabled INTEGER,
				ace_dcw_mode TEXT,
				ace_dcw_scaler REAL,
				ace_dcw_high_scaler REAL,
				ace_dcw_wavelet TEXT,
				current_order_index REAL,
			last_seen_at INTEGER,
			prompt_epoch INTEGER DEFAULT 0,
			steer_history TEXT,
			manager_brief TEXT,
			manager_plan TEXT,
			manager_epoch INTEGER,
			manager_updated_at INTEGER,
			owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			is_temporary INTEGER NOT NULL DEFAULT 0,
			expires_at INTEGER,
			description TEXT,
			description_updated_at INTEGER
			);

			CREATE INDEX IF NOT EXISTS playlists_by_playlist_key ON playlists(playlist_key);

		CREATE TABLE IF NOT EXISTS songs (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
			order_index REAL NOT NULL,
			title TEXT,
			artist_name TEXT,
			genre TEXT,
			sub_genre TEXT,
			lyrics TEXT,
			caption TEXT,
			cover_prompt TEXT,
			cover_url TEXT,
			cover_webp_url TEXT,
			cover_jxl_url TEXT,
			bpm REAL,
			key_scale TEXT,
			time_signature TEXT,
			audio_duration REAL,
			vocal_style TEXT,
			mood TEXT,
			energy TEXT,
			era TEXT,
			instruments TEXT,
			tags TEXT,
			themes TEXT,
			language TEXT,
			description TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			ace_task_id TEXT,
			ace_submitted_at INTEGER,
			audio_url TEXT,
			storage_path TEXT,
			ace_audio_path TEXT,
			error_message TEXT,
			retry_count INTEGER DEFAULT 0,
			errored_at_status TEXT,
			cancelled_at_status TEXT,
			generation_started_at INTEGER,
			generation_completed_at INTEGER,
			is_interrupt INTEGER,
			interrupt_prompt TEXT,
			llm_provider TEXT,
			llm_model TEXT,
			prompt_epoch INTEGER,
			user_rating TEXT,
			play_duration_ms INTEGER,
			listen_count INTEGER DEFAULT 0,
			metadata_processing_ms INTEGER,
			cover_processing_ms INTEGER,
			audio_processing_ms INTEGER,
			persona_extract TEXT
		);

		CREATE INDEX IF NOT EXISTS songs_by_playlist ON songs(playlist_id);
		CREATE INDEX IF NOT EXISTS songs_by_playlist_status ON songs(playlist_id, status);
		CREATE INDEX IF NOT EXISTS songs_by_playlist_order ON songs(playlist_id, order_index);
		CREATE INDEX IF NOT EXISTS songs_by_user_rating ON songs(user_rating);

		CREATE TABLE IF NOT EXISTS radio_stations (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			current_song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
			current_play_id TEXT,
			started_at INTEGER,
			paused_at INTEGER,
			paused_offset_ms INTEGER NOT NULL DEFAULT 0,
			is_playing INTEGER NOT NULL DEFAULT 0,
			active_listener_count INTEGER NOT NULL DEFAULT 0,
			schedule_version INTEGER NOT NULL DEFAULT 0,
			inventory_target INTEGER NOT NULL DEFAULT 10
		);

		CREATE TABLE IF NOT EXISTS albums (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			title TEXT NOT NULL,
			band_name TEXT,
			theme TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'generating',
			generation_kind TEXT NOT NULL DEFAULT 'default',
			cover_prompt TEXT,
			cover_url TEXT,
			cover_webp_url TEXT,
			cover_jxl_url TEXT,
			trend_research_json TEXT,
			band_persona_json TEXT,
			vocal_plan_json TEXT,
			request_id TEXT,
			first_played_at INTEGER,
			ready_at INTEGER,
			completed_at INTEGER
		);

		CREATE INDEX IF NOT EXISTS albums_by_status_first_played
			ON albums(status, first_played_at);
		CREATE INDEX IF NOT EXISTS albums_by_generation_kind
			ON albums(generation_kind);

		CREATE TABLE IF NOT EXISTS radio_plays (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
			album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
			started_at INTEGER NOT NULL,
			ended_at INTEGER,
			completed INTEGER NOT NULL DEFAULT 0,
			skipped INTEGER NOT NULL DEFAULT 0,
			listener_count_snapshot INTEGER NOT NULL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS radio_plays_by_started ON radio_plays(started_at);
		CREATE INDEX IF NOT EXISTS radio_plays_by_song ON radio_plays(song_id);
		CREATE INDEX IF NOT EXISTS radio_plays_by_album ON radio_plays(album_id);

		CREATE TABLE IF NOT EXISTS radio_schedule (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			station_id TEXT NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
			slot_index INTEGER NOT NULL,
			song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
			reason TEXT NOT NULL,
			score REAL NOT NULL DEFAULT 0,
			locked INTEGER NOT NULL DEFAULT 0,
			is_request INTEGER NOT NULL DEFAULT 0,
			schedule_version INTEGER NOT NULL
		);

		CREATE INDEX IF NOT EXISTS radio_schedule_by_station_slot
			ON radio_schedule(station_id, slot_index);
		CREATE INDEX IF NOT EXISTS radio_schedule_by_version
			ON radio_schedule(schedule_version);

		CREATE TABLE IF NOT EXISTS radio_requests (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			prompt TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'auto',
			status TEXT NOT NULL DEFAULT 'pending',
			matched_song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
			album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
			target_song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
			schedule_slot INTEGER,
			notification_state TEXT
		);

		CREATE INDEX IF NOT EXISTS radio_requests_by_status ON radio_requests(status);
		CREATE INDEX IF NOT EXISTS radio_requests_by_kind ON radio_requests(kind);

		CREATE TABLE IF NOT EXISTS settings (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			key TEXT NOT NULL UNIQUE,
			value TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS settings_by_key ON settings(key);

		CREATE TABLE IF NOT EXISTS devices (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			status TEXT NOT NULL DEFAULT 'active',
			last_seen_at INTEGER,
			capabilities TEXT,
			daemon_version TEXT
		);

		CREATE INDEX IF NOT EXISTS devices_by_owner_user_id ON devices(owner_user_id);
		CREATE INDEX IF NOT EXISTS devices_by_status ON devices(status);

		CREATE TABLE IF NOT EXISTS playlist_device_assignments (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
			device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
			assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			assigned_at INTEGER NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1
		);

		CREATE INDEX IF NOT EXISTS playlist_device_assignments_by_playlist
			ON playlist_device_assignments(playlist_id);
		CREATE INDEX IF NOT EXISTS playlist_device_assignments_by_device
			ON playlist_device_assignments(device_id);
			CREATE INDEX IF NOT EXISTS playlist_device_assignments_by_active
				ON playlist_device_assignments(is_active);

			CREATE TABLE IF NOT EXISTS agent_channel_messages (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
				thread_id TEXT,
				sender_kind TEXT NOT NULL,
				sender_id TEXT NOT NULL,
				message_type TEXT NOT NULL,
				visibility TEXT NOT NULL DEFAULT 'public',
				content TEXT NOT NULL,
				data_json TEXT,
				correlation_id TEXT
			);

			CREATE INDEX IF NOT EXISTS agent_channel_messages_by_playlist
				ON agent_channel_messages(playlist_id, created_at);
			CREATE INDEX IF NOT EXISTS agent_channel_messages_by_thread
				ON agent_channel_messages(playlist_id, thread_id);
			CREATE INDEX IF NOT EXISTS agent_channel_messages_by_correlation
				ON agent_channel_messages(correlation_id);

			CREATE TABLE IF NOT EXISTS agent_memory_entries (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				scope TEXT NOT NULL,
				playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
				kind TEXT NOT NULL,
				title TEXT NOT NULL,
				content_json TEXT NOT NULL,
				confidence REAL NOT NULL DEFAULT 0.5,
				importance REAL NOT NULL DEFAULT 0.5,
				use_count INTEGER NOT NULL DEFAULT 0,
				last_used_at INTEGER,
				expires_at INTEGER,
				deleted_at INTEGER
			);

			CREATE INDEX IF NOT EXISTS agent_memory_entries_by_scope
				ON agent_memory_entries(scope, playlist_id);
			CREATE INDEX IF NOT EXISTS agent_memory_entries_by_kind
				ON agent_memory_entries(kind);
			CREATE INDEX IF NOT EXISTS agent_memory_entries_by_deleted
				ON agent_memory_entries(deleted_at);

			CREATE TABLE IF NOT EXISTS agent_runs (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				playlist_id TEXT REFERENCES playlists(id) ON DELETE CASCADE,
				agent_id TEXT NOT NULL,
				session_key TEXT,
				trigger TEXT NOT NULL,
				status TEXT NOT NULL,
				input_json TEXT,
				output_json TEXT,
				error TEXT
			);

			CREATE INDEX IF NOT EXISTS agent_runs_by_playlist
				ON agent_runs(playlist_id, created_at);
			CREATE INDEX IF NOT EXISTS agent_runs_by_agent
				ON agent_runs(agent_id, created_at);
		`);

	// Additive column migrations (idempotent — ignores "duplicate column" errors).
	// SQLite only supports one ADD COLUMN per ALTER TABLE statement.
	addColumn("playlists", "is_starred INTEGER DEFAULT 0");
	addColumn("playlists", "manager_brief TEXT");
	addColumn("playlists", "manager_plan TEXT");
	addColumn("playlists", "manager_epoch INTEGER");
	addColumn("playlists", "manager_updated_at INTEGER");
	addColumn(
		"playlists",
		"owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
	);
	addColumn("playlists", "is_temporary INTEGER NOT NULL DEFAULT 0");
	addColumn("playlists", "expires_at INTEGER");
	addColumn("playlists", "description TEXT");
	addColumn("playlists", "description_updated_at INTEGER");
	addColumn("playlists", "ace_thinking INTEGER");
	addColumn("playlists", "ace_auto_duration INTEGER");
	addColumn("playlists", "ace_model TEXT");
	addColumn("playlists", "ace_dcw_enabled INTEGER");
	addColumn("playlists", "ace_dcw_mode TEXT");
	addColumn("playlists", "ace_dcw_scaler REAL");
	addColumn("playlists", "ace_dcw_high_scaler REAL");
	addColumn("playlists", "ace_dcw_wavelet TEXT");
	addColumn("albums", "band_name TEXT");
	addColumn("albums", "band_persona_json TEXT");
	addColumn("songs", "cover_webp_url TEXT");
	addColumn("songs", "cover_jxl_url TEXT");
	addColumn("songs", "album_id TEXT REFERENCES albums(id) ON DELETE SET NULL");
	addColumn("songs", "album_track_number INTEGER");
	addColumn("songs", "radio_eligible INTEGER NOT NULL DEFAULT 0");
	addColumn("songs", "like_count INTEGER NOT NULL DEFAULT 0");
	addColumn("songs", "dislike_count INTEGER NOT NULL DEFAULT 0");
	addColumn("songs", "skip_count INTEGER NOT NULL DEFAULT 0");
	addColumn("songs", "radio_play_count INTEGER NOT NULL DEFAULT 0");
	addColumn("songs", "last_radio_played_at INTEGER");
	addColumn("songs", "ace_task_type TEXT");
	addColumn("songs", "source_song_id TEXT");
	addColumn("songs", "source_audio_path TEXT");
	addColumn("songs", "cover_noise_strength REAL");
	addColumn(
		"songs",
		"request_id TEXT REFERENCES radio_requests(id) ON DELETE SET NULL",
	);

	sqlite.exec(`
		CREATE INDEX IF NOT EXISTS playlists_by_owner_user_id ON playlists(owner_user_id);
		CREATE INDEX IF NOT EXISTS playlists_by_is_temporary ON playlists(is_temporary);
		CREATE INDEX IF NOT EXISTS songs_by_album ON songs(album_id, album_track_number);
		CREATE INDEX IF NOT EXISTS songs_by_radio_eligible_status ON songs(radio_eligible, status);
		INSERT OR IGNORE INTO radio_stations (
			id,
			created_at,
			updated_at,
			paused_offset_ms,
			is_playing,
			active_listener_count,
			schedule_version,
			inventory_target
		) VALUES (
			'global',
			strftime('%s','now') * 1000,
			strftime('%s','now') * 1000,
			0,
			0,
			0,
			0,
			10
		);
		UPDATE songs SET radio_eligible = 0 WHERE album_id IS NULL;
		UPDATE albums
		SET band_name = 'Infinitune Radio'
		WHERE band_name IS NULL OR trim(band_name) = '';
		UPDATE albums
		SET band_persona_json = json_object(
			'name',
			band_name,
			'origin',
			'Global radio house band identity',
			'sound',
			theme,
			'visualIdentity',
			'Square CD-box album cover artwork with readable band and album text'
		)
		WHERE band_persona_json IS NULL OR trim(band_persona_json) = '';
		UPDATE albums
		SET cover_prompt =
			'Square CD-box front album cover, 1:1 composition, designed for a physical jewel case. Album title "' ||
			title ||
			'" by band "' ||
			band_name ||
			'". Include only these readable words: "' ||
			band_name ||
			'" and "' ||
			title ||
			'". Bold music release artwork, strong thumbnail readability, no mockup, no plastic case, no extra text. Theme: ' ||
			theme
		WHERE cover_prompt IS NULL
			OR cover_prompt LIKE '%no text%'
			OR cover_prompt LIKE '%compact-disc%'
			OR cover_prompt LIKE '%CD disc%';
		UPDATE songs
		SET artist_name = (
			SELECT band_name FROM albums WHERE albums.id = songs.album_id
		)
		WHERE radio_eligible = 1
			AND album_id IS NOT NULL
			AND (artist_name IS NULL OR artist_name = 'Infinitune Radio');
		UPDATE songs
		SET cover_prompt = (
			SELECT cover_prompt FROM albums WHERE albums.id = songs.album_id
		)
		WHERE radio_eligible = 1
			AND album_id IS NOT NULL
			AND album_track_number = 1
			AND (
				cover_prompt IS NULL
				OR cover_prompt LIKE '%no text%'
				OR cover_prompt LIKE '%compact-disc%'
				OR cover_prompt LIKE '%CD disc%'
			);
		WITH radio_song_order AS (
			SELECT
				s.id,
				ROW_NUMBER() OVER (
					PARTITION BY s.playlist_id
					ORDER BY s.created_at, COALESCE(s.album_track_number, s.order_index), s.id
				) AS clean_order
			FROM songs s
			JOIN playlists p ON p.id = s.playlist_id
			WHERE p.playlist_key = 'global-radio'
		)
		UPDATE songs
		SET order_index = (
			SELECT clean_order
			FROM radio_song_order
			WHERE radio_song_order.id = songs.id
		)
		WHERE id IN (SELECT id FROM radio_song_order);
	`);

	logger.info("Database schema ensured");
}
