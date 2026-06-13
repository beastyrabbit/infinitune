import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testSqlite: InstanceType<typeof Database>;

vi.mock("../db/index", () => ({
	get sqlite() {
		return testSqlite;
	},
}));

vi.mock("../logger", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}));

import { ensureSchema } from "../db/migrate";

describe("radio migration", () => {
	beforeEach(() => {
		testSqlite = new Database(":memory:");
	});

	afterEach(() => {
		testSqlite.close();
	});

	it("is idempotent and marks pre-radio songs as legacy", () => {
		ensureSchema();
		testSqlite
			.prepare(
				`
					INSERT INTO playlists (
						id,
						created_at,
						name,
						prompt,
						llm_provider,
						llm_model
					) VALUES ('playlist-1', 1, 'Old', 'old', 'openai-codex', 'gpt-5.2')
				`,
			)
			.run();
		testSqlite
			.prepare(
				`
					INSERT INTO songs (
						id,
						created_at,
						playlist_id,
						order_index,
						status,
						title,
						radio_eligible
					) VALUES ('song-1', 1, 'playlist-1', 1, 'ready', 'Old Song', 1)
				`,
			)
			.run();

		ensureSchema();
		ensureSchema();

		const song = testSqlite
			.prepare(
				"SELECT album_id as albumId, radio_eligible as radioEligible FROM songs WHERE id = 'song-1'",
			)
			.get() as { albumId: string | null; radioEligible: number };
		const stationCount = testSqlite
			.prepare(
				"SELECT COUNT(*) as count FROM radio_stations WHERE id = 'global'",
			)
			.get() as { count: number };

		expect(song.albumId).toBeNull();
		expect(song.radioEligible).toBe(0);
		expect(stationCount.count).toBe(1);
	});
});
