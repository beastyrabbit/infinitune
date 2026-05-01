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
	addColumn("songs", "cover_webp_url TEXT");
	addColumn("songs", "cover_jxl_url TEXT");

	sqlite.exec(`
		CREATE INDEX IF NOT EXISTS playlists_by_owner_user_id ON playlists(owner_user_id);
		CREATE INDEX IF NOT EXISTS playlists_by_is_temporary ON playlists(is_temporary);
	`);

	logger.info("Database schema ensured");
}
