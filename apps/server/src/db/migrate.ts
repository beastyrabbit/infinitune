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

	// SQLite only supports one ADD COLUMN per ALTER TABLE statement.
	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN manager_brief TEXT");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add manager_brief column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN manager_plan TEXT");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add manager_plan column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN manager_epoch INTEGER");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add manager_epoch column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN manager_updated_at INTEGER");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error(
				{ err },
				"Failed to add manager_updated_at column to playlists",
			);
			throw err;
		}
	}

	try {
		sqlite.exec(
			"ALTER TABLE playlists ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add owner_user_id column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec(
			"ALTER TABLE playlists ADD COLUMN is_temporary INTEGER NOT NULL DEFAULT 0",
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add is_temporary column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN expires_at INTEGER");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add expires_at column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec("ALTER TABLE playlists ADD COLUMN description TEXT");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error({ err }, "Failed to add description column to playlists");
			throw err;
		}
	}

	try {
		sqlite.exec(
			"ALTER TABLE playlists ADD COLUMN description_updated_at INTEGER",
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("duplicate column name")) {
			logger.error(
				{ err },
				"Failed to add description_updated_at column to playlists",
			);
			throw err;
		}
	}

	sqlite.exec(`
		CREATE INDEX IF NOT EXISTS playlists_by_owner_user_id ON playlists(owner_user_id);
		CREATE INDEX IF NOT EXISTS playlists_by_is_temporary ON playlists(is_temporary);
	`);

	logger.info("Database schema ensured");
}
