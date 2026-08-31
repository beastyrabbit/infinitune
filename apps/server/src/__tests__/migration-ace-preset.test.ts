import {
	ACE_DCW_DEFAULTS,
	ACE_GENERATION_DEFAULTS,
	ACE_QUALITY_DEFAULT_MODEL,
} from "@infinitune/shared/ace-settings";
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

const MIGRATION_KEY = "migration.acePresetMVersion";

const LEGACY_ACE_DEFAULTS = {
	aceModel: "acestep-v15-xl-turbo",
	aceInferenceSteps: "8",
	aceInferMethod: "ode",
	aceDcwEnabled: "true",
	aceDcwMode: "double",
	aceDcwScaler: "0.05",
	aceDcwHighScaler: "0.02",
	aceDcwWavelet: "haar",
	aceThinking: "false",
} as const;

const PRESET_M_NEW_SETTINGS = {
	aceGuidanceScale: String(ACE_GENERATION_DEFAULTS.guidanceScale),
	aceSamplerMode: ACE_GENERATION_DEFAULTS.samplerMode,
	aceShift: String(ACE_GENERATION_DEFAULTS.shift),
	aceVelocityNormThreshold: String(
		ACE_GENERATION_DEFAULTS.velocityNormThreshold,
	),
	aceVelocityEmaFactor: String(ACE_GENERATION_DEFAULTS.velocityEmaFactor),
	aceUseAdg: String(ACE_GENERATION_DEFAULTS.useAdg),
} as const;

const PRESET_M_SETTINGS = {
	aceModel: ACE_QUALITY_DEFAULT_MODEL,
	aceInferenceSteps: String(ACE_GENERATION_DEFAULTS.inferenceSteps),
	aceInferMethod: ACE_GENERATION_DEFAULTS.inferMethod,
	...PRESET_M_NEW_SETTINGS,
	aceDcwEnabled: String(ACE_DCW_DEFAULTS.enabled),
	aceDcwMode: ACE_DCW_DEFAULTS.mode,
	aceDcwScaler: String(ACE_DCW_DEFAULTS.scaler),
	aceDcwHighScaler: String(ACE_DCW_DEFAULTS.highScaler),
	aceDcwWavelet: ACE_DCW_DEFAULTS.wavelet,
	aceThinking: String(ACE_GENERATION_DEFAULTS.thinking),
} as const;

type AcePlaylistRow = {
	aceModel: string | null;
	inferenceSteps: number | null;
	inferMethod: string | null;
	aceDcwEnabled: number | null;
	aceDcwMode: string | null;
	aceDcwScaler: number | null;
	aceDcwHighScaler: number | null;
	aceDcwWavelet: string | null;
	aceThinking: number | null;
};

function readSettings(): Record<string, string> {
	const rows = testSqlite
		.prepare("SELECT key, value FROM settings")
		.all() as Array<{ key: string; value: string }>;
	return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
}

function replaceSettings(settings: Record<string, string>): void {
	testSqlite.prepare("DELETE FROM settings").run();
	const insert = testSqlite.prepare(`
		INSERT INTO settings (id, created_at, key, value)
		VALUES (?, 1, ?, ?)
	`);
	for (const [key, value] of Object.entries(settings)) {
		insert.run(`setting-${key}`, key, value);
	}
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

function insertLegacyPlaylist(id: string, dcwScaler = 0.05): void {
	testSqlite
		.prepare(
			`
				INSERT INTO playlists (
					id,
					created_at,
					name,
					prompt,
					llm_provider,
					llm_model,
					ace_model,
					inference_steps,
					infer_method,
					ace_dcw_enabled,
					ace_dcw_mode,
					ace_dcw_scaler,
					ace_dcw_high_scaler,
					ace_dcw_wavelet,
					ace_thinking
				) VALUES (?, 1, ?, 'prompt', 'openrouter', 'model', ?, 8, 'ode', 1, 'double', ?, 0.02, 'haar', 0)
			`,
		)
		.run(id, id, LEGACY_ACE_DEFAULTS.aceModel, dcwScaler);
}

function readAcePlaylist(id: string): AcePlaylistRow {
	return testSqlite
		.prepare(
			`
				SELECT
					ace_model AS aceModel,
					inference_steps AS inferenceSteps,
					infer_method AS inferMethod,
					ace_dcw_enabled AS aceDcwEnabled,
					ace_dcw_mode AS aceDcwMode,
					ace_dcw_scaler AS aceDcwScaler,
					ace_dcw_high_scaler AS aceDcwHighScaler,
					ace_dcw_wavelet AS aceDcwWavelet,
					ace_thinking AS aceThinking
				FROM playlists
				WHERE id = ?
			`,
		)
		.get(id) as AcePlaylistRow;
}

describe("ACE Preset M migration", () => {
	beforeEach(() => {
		testSqlite = new Database(":memory:");
	});

	afterEach(() => {
		testSqlite.close();
	});

	it("seeds Preset M on a fresh database and does not repeat the migration", () => {
		ensureSchema();

		expect(readSettings()).toMatchObject({
			...PRESET_M_SETTINGS,
			[MIGRATION_KEY]: "1",
		});

		testSqlite
			.prepare("UPDATE settings SET value = '4' WHERE key = 'aceShift'")
			.run();
		ensureSchema();

		expect(readSettings().aceShift).toBe("4");
	});

	it("advances an older migration marker without overwriting an existing profile", () => {
		ensureSchema();
		testSqlite
			.prepare(
				`UPDATE settings
					 SET value = CASE key
						WHEN ? THEN '0'
						WHEN 'aceShift' THEN '4'
						ELSE value
					 END
				 WHERE key IN (?, 'aceShift')`,
			)
			.run(MIGRATION_KEY, MIGRATION_KEY);

		ensureSchema();

		expect(readSettings()).toMatchObject({
			[MIGRATION_KEY]: "1",
			aceShift: "4",
		});
	});

	it("migrates the exact legacy ACE-Step URL after Preset M is already marked complete", () => {
		ensureSchema();
		expect(readSettings()[MIGRATION_KEY]).toBe("1");
		upsertSetting("aceStepUrl", "http://192.168.10.120:8001");

		ensureSchema();
		expect(readSettings().aceStepUrl).toBe("http://192.168.10.242:8001");

		ensureSchema();
		expect(readSettings().aceStepUrl).toBe("http://192.168.10.242:8001");
	});

	it.each(["http://ace.internal:8001", "http://192.168.10.242:8001", ""])(
		"preserves a non-legacy ACE-Step URL: %j",
		(aceStepUrl) => {
			ensureSchema();
			upsertSetting("aceStepUrl", aceStepUrl);

			ensureSchema();

			expect(readSettings().aceStepUrl).toBe(aceStepUrl);
		},
	);

	it("clears legacy playlist defaults when global ACE settings are empty", () => {
		ensureSchema();
		replaceSettings({});
		insertLegacyPlaylist("legacy-with-empty-settings");

		ensureSchema();

		expect(readSettings()).toMatchObject({
			...PRESET_M_SETTINGS,
			[MIGRATION_KEY]: "1",
		});
		expect(readAcePlaylist("legacy-with-empty-settings")).toEqual({
			aceModel: null,
			inferenceSteps: null,
			inferMethod: null,
			aceDcwEnabled: null,
			aceDcwMode: null,
			aceDcwScaler: null,
			aceDcwHighScaler: null,
			aceDcwWavelet: null,
			aceThinking: null,
		});
	});

	it("migrates the exact legacy global profile and only matching playlist overrides", () => {
		ensureSchema();
		replaceSettings(LEGACY_ACE_DEFAULTS);
		insertLegacyPlaylist("matching");
		insertLegacyPlaylist("deviating", 0.06);

		ensureSchema();

		expect(readSettings()).toMatchObject({
			...PRESET_M_SETTINGS,
			[MIGRATION_KEY]: "1",
		});
		expect(readAcePlaylist("matching")).toEqual({
			aceModel: null,
			inferenceSteps: null,
			inferMethod: null,
			aceDcwEnabled: null,
			aceDcwMode: null,
			aceDcwScaler: null,
			aceDcwHighScaler: null,
			aceDcwWavelet: null,
			aceThinking: null,
		});
		expect(readAcePlaylist("deviating")).toEqual({
			aceModel: LEGACY_ACE_DEFAULTS.aceModel,
			inferenceSteps: 8,
			inferMethod: "ode",
			aceDcwEnabled: 1,
			aceDcwMode: "double",
			aceDcwScaler: 0.06,
			aceDcwHighScaler: 0.02,
			aceDcwWavelet: "haar",
			aceThinking: 0,
		});
	});

	it("preserves a custom global profile and its playlist overrides", () => {
		ensureSchema();
		const customSettings = {
			...LEGACY_ACE_DEFAULTS,
			aceInferenceSteps: "17",
		};
		replaceSettings(customSettings);
		insertLegacyPlaylist("legacy-override");

		ensureSchema();

		expect(readSettings()).toMatchObject({
			...customSettings,
			...PRESET_M_NEW_SETTINGS,
			[MIGRATION_KEY]: "1",
		});
		expect(readAcePlaylist("legacy-override")).toEqual({
			aceModel: LEGACY_ACE_DEFAULTS.aceModel,
			inferenceSteps: 8,
			inferMethod: "ode",
			aceDcwEnabled: 1,
			aceDcwMode: "double",
			aceDcwScaler: 0.05,
			aceDcwHighScaler: 0.02,
			aceDcwWavelet: "haar",
			aceThinking: 0,
		});
	});
});
