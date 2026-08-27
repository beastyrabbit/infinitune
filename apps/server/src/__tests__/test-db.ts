/**
 * Test helper: in-memory SQLite database for service layer tests.
 *
 * Usage in test files:
 *   import { setupTestDb, teardownTestDb, getTestDb } from "./test-db";
 *   beforeEach(() => setupTestDb());
 *   afterEach(() => teardownTestDb());
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

let testSqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

const SCHEMA_SQL = `
	CREATE TABLE users (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL,
		shoo_subject TEXT NOT NULL UNIQUE,
		display_name TEXT,
		email TEXT,
		picture TEXT,
		last_seen_at INTEGER
	);

	CREATE TABLE playlists (
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
		is_starred INTEGER DEFAULT 0,
		owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
		is_temporary INTEGER NOT NULL DEFAULT 0,
		expires_at INTEGER,
		ace_thinking INTEGER,
		ace_auto_duration INTEGER,
		description TEXT,
		description_updated_at INTEGER
	);

	CREATE TABLE songs (
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
		ace_task_type TEXT,
		source_song_id TEXT,
		source_audio_path TEXT,
		source_url TEXT,
		cover_noise_strength REAL,
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
		persona_extract TEXT,
		album_id TEXT REFERENCES albums(id) ON DELETE SET NULL,
		album_track_number INTEGER,
		radio_eligible INTEGER NOT NULL DEFAULT 0,
		like_count INTEGER NOT NULL DEFAULT 0,
		dislike_count INTEGER NOT NULL DEFAULT 0,
		skip_count INTEGER NOT NULL DEFAULT 0,
		radio_play_count INTEGER NOT NULL DEFAULT 0,
		last_radio_played_at INTEGER,
		request_id TEXT REFERENCES radio_requests(id) ON DELETE SET NULL
	);

	CREATE TABLE radio_stations (
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

	CREATE TABLE albums (
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
		request_id TEXT REFERENCES radio_requests(id) ON DELETE SET NULL,
		first_played_at INTEGER,
		ready_at INTEGER,
		completed_at INTEGER
	);

	CREATE TABLE radio_plays (
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

	CREATE TABLE radio_schedule (
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

	CREATE TABLE radio_requests (
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

	CREATE TABLE cover_sources (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL,
		url TEXT NOT NULL,
		genre_tag TEXT,
		status TEXT NOT NULL DEFAULT 'pending',
		last_used_at INTEGER,
		resolved_audio_path TEXT
	);

	CREATE TABLE settings (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL,
		key TEXT NOT NULL UNIQUE,
		value TEXT NOT NULL
	);

	CREATE TABLE devices (
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

		CREATE TABLE playlist_device_assignments (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
			device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
			assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			assigned_at INTEGER NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE agent_channel_messages (
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

		CREATE TABLE agent_memory_entries (
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

		CREATE TABLE agent_runs (
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

		CREATE TABLE radio_station_presets (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			name TEXT NOT NULL,
			description TEXT,
			genre_prompt TEXT NOT NULL,
			vocal_style TEXT,
			is_active INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE share_links (
			id TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			token TEXT NOT NULL UNIQUE,
			resource_type TEXT NOT NULL,
			resource_id TEXT NOT NULL,
			expires_at INTEGER,
			revoked_at INTEGER
		);

		CREATE TRIGGER share_links_cleanup_playlist
			BEFORE DELETE ON playlists
			BEGIN
				DELETE FROM share_links
					WHERE resource_type = 'playlist' AND resource_id = OLD.id;
				DELETE FROM share_links
					WHERE resource_type = 'song'
						AND resource_id IN (
							SELECT id FROM songs WHERE playlist_id = OLD.id
						);
			END;

		CREATE TRIGGER share_links_cleanup_song
			AFTER DELETE ON songs
			BEGIN
				DELETE FROM share_links
					WHERE resource_type = 'song' AND resource_id = OLD.id;
			END;
	`;

export function setupTestDb() {
	testSqlite = new Database(":memory:");
	testSqlite.pragma("foreign_keys = ON");
	testSqlite.exec(SCHEMA_SQL);
	testDb = drizzle(testSqlite, { schema });
}

export function teardownTestDb() {
	testSqlite?.close();
}

export function getTestDb() {
	return testDb;
}

export function getTestSqlite() {
	return testSqlite;
}
