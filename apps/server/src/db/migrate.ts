import { logger } from "../logger";
import { sqlite } from "./index";

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
			current_order_index REAL,
			last_seen_at INTEGER,
			prompt_epoch INTEGER DEFAULT 0,
			steer_history TEXT
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
	`);

	// Additive column migrations (idempotent — ignores "duplicate column" errors)
	try {
		sqlite.exec(
			"ALTER TABLE playlists ADD COLUMN is_starred INTEGER DEFAULT 0",
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add is_starred column to playlists");
			throw err;
		}
	}

	logger.info("Database schema ensured");
}
