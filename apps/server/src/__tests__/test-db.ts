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
		current_order_index REAL,
		last_seen_at INTEGER,
		prompt_epoch INTEGER DEFAULT 0,
		steer_history TEXT
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

	CREATE TABLE settings (
		id TEXT PRIMARY KEY,
		created_at INTEGER NOT NULL,
		key TEXT NOT NULL UNIQUE,
		value TEXT NOT NULL
	);
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
