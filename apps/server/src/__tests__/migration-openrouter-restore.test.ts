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

const MIGRATION_KEY = "migration.openrouterRestoreVersion";

function readSettings(): Record<string, string> {
	const rows = testSqlite
		.prepare("SELECT key, value FROM settings")
		.all() as Array<{ key: string; value: string }>;
	return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function upsertSetting(key: string, value: string): void {
	testSqlite
		.prepare(
			`INSERT INTO settings (id, created_at, key, value)
			 VALUES (?, 1, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		)
		.run(`setting-${key}`, key, value);
}

function insertPlaylist(id: string, provider: string, model: string): void {
	testSqlite
		.prepare(
			`INSERT INTO playlists (
				id, created_at, name, prompt, llm_provider, llm_model
			 ) VALUES (?, 1, ?, 'prompt', ?, ?)`,
		)
		.run(id, id, provider, model);
}

function readPlaylist(id: string): { provider: string; model: string } {
	return testSqlite
		.prepare(
			`SELECT llm_provider AS provider, llm_model AS model
			 FROM playlists WHERE id = ?`,
		)
		.get(id) as { provider: string; model: string };
}

describe("restored OpenRouter migration", () => {
	beforeEach(() => {
		testSqlite = new Database(":memory:");
		ensureSchema();
		testSqlite.prepare("DELETE FROM settings WHERE key = ?").run(MIGRATION_KEY);
	});

	afterEach(() => {
		testSqlite.close();
	});

	it("resets pre-existing OpenRouter settings and playlists to Codex", () => {
		upsertSetting("textProvider", "openrouter");
		upsertSetting("textModel", "openrouter/auto");
		upsertSetting("personaProvider", "openrouter");
		upsertSetting("personaModel", "anthropic/claude-sonnet-4");
		insertPlaylist("legacy-openrouter", "openrouter", "openrouter/auto");
		insertPlaylist("existing-codex", "openai-codex", "custom-codex-model");

		ensureSchema();

		expect(readSettings()).toMatchObject({
			[MIGRATION_KEY]: "1",
			textProvider: "openai-codex",
			textModel: "gpt-5.2",
			personaProvider: "openai-codex",
			personaModel: "gpt-5.2",
		});
		expect(readPlaylist("legacy-openrouter")).toEqual({
			provider: "openai-codex",
			model: "gpt-5.2",
		});
		expect(readPlaylist("existing-codex")).toEqual({
			provider: "openai-codex",
			model: "custom-codex-model",
		});
	});

	it("only changes a model when its corresponding provider is OpenRouter", () => {
		upsertSetting("textProvider", "openai-codex");
		upsertSetting("textModel", "custom-codex-model");
		upsertSetting("personaProvider", "openrouter");
		upsertSetting("personaModel", "openrouter/auto");

		ensureSchema();

		expect(readSettings()).toMatchObject({
			[MIGRATION_KEY]: "1",
			textProvider: "openai-codex",
			textModel: "custom-codex-model",
			personaProvider: "openai-codex",
			personaModel: "gpt-5.2",
		});
	});

	it("does not reset OpenRouter after the migration marker is written", () => {
		ensureSchema();
		upsertSetting("textProvider", "openrouter");
		upsertSetting("textModel", "openrouter/auto");
		upsertSetting("personaProvider", "openrouter");
		upsertSetting("personaModel", "openrouter/auto");
		insertPlaylist("deliberate-openrouter", "openrouter", "openrouter/auto");

		ensureSchema();

		expect(readSettings()).toMatchObject({
			[MIGRATION_KEY]: "1",
			textProvider: "openrouter",
			textModel: "openrouter/auto",
			personaProvider: "openrouter",
			personaModel: "openrouter/auto",
		});
		expect(readPlaylist("deliberate-openrouter")).toEqual({
			provider: "openrouter",
			model: "openrouter/auto",
		});
	});
});
