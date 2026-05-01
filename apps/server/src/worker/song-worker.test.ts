import { describe, expect, it } from "vitest";
import type { PlaylistWire, SongWire } from "../wire";
import { buildAceSubmitInput, type SongWorkerSettings } from "./song-worker";

const baseSettings: SongWorkerSettings = {
	textProvider: "openai-codex",
	textModel: "gpt-5.1",
	imageProvider: "comfyui",
	aceModel: "acestep-v15-xl-turbo",
	aceInferenceSteps: 12,
	aceLmTemperature: 1.1,
	aceLmCfgScale: 3.5,
	aceInferMethod: "sde",
	aceDcwEnabled: false,
	aceDcwMode: "high",
	aceDcwScaler: 0.1,
	aceDcwHighScaler: 0.04,
	aceDcwWavelet: "db4",
	aceThinking: true,
	aceAutoDuration: false,
	personaProvider: "openai-codex",
	personaModel: "gpt-5.1",
};

function makeSong(): SongWire {
	return {
		lyrics: "hello world",
		caption: "bright synth pop",
		vocalStyle: "clear vocal",
		bpm: 118,
		keyScale: "D minor",
		timeSignature: "3/4",
		audioDuration: 192,
	} as SongWire;
}

function makePlaylist(overrides: Partial<PlaylistWire> = {}): PlaylistWire {
	return {
		lyricsLanguage: "english",
		aceModel: null,
		inferenceSteps: null,
		lmTemperature: null,
		lmCfgScale: null,
		inferMethod: null,
		aceDcwEnabled: null,
		aceDcwMode: null,
		aceDcwScaler: null,
		aceDcwHighScaler: null,
		aceDcwWavelet: null,
		aceThinking: null,
		aceAutoDuration: null,
		...overrides,
	} as PlaylistWire;
}

describe("buildAceSubmitInput", () => {
	it("inherits global ACE settings when playlist overrides are null", () => {
		const input = buildAceSubmitInput({
			song: makeSong(),
			playlist: makePlaylist(),
			settings: baseSettings,
		});

		expect(input.aceModel).toBe("acestep-v15-xl-turbo");
		expect(input.inferenceSteps).toBe(12);
		expect(input.lmTemperature).toBe(1.1);
		expect(input.lmCfgScale).toBe(3.5);
		expect(input.inferMethod).toBe("sde");
		expect(input.aceDcwEnabled).toBe(false);
		expect(input.aceDcwMode).toBe("high");
		expect(input.aceDcwScaler).toBe(0.1);
		expect(input.aceDcwHighScaler).toBe(0.04);
		expect(input.aceDcwWavelet).toBe("db4");
		expect(input.aceThinking).toBe(true);
		expect(input.aceAutoDuration).toBe(false);
	});

	it("uses explicit playlist ACE overrides ahead of global settings", () => {
		const input = buildAceSubmitInput({
			song: makeSong(),
			playlist: makePlaylist({
				aceModel: "acestep-v15-turbo",
				inferenceSteps: 6,
				lmTemperature: 0.7,
				lmCfgScale: 2,
				inferMethod: "ode",
				aceDcwEnabled: true,
				aceDcwMode: "double",
				aceDcwScaler: 0.05,
				aceDcwHighScaler: 0.02,
				aceDcwWavelet: "haar",
				aceThinking: false,
				aceAutoDuration: true,
			}),
			settings: baseSettings,
		});

		expect(input.aceModel).toBe("acestep-v15-turbo");
		expect(input.inferenceSteps).toBe(6);
		expect(input.lmTemperature).toBe(0.7);
		expect(input.lmCfgScale).toBe(2);
		expect(input.inferMethod).toBe("ode");
		expect(input.aceDcwEnabled).toBe(true);
		expect(input.aceDcwMode).toBe("double");
		expect(input.aceDcwScaler).toBe(0.05);
		expect(input.aceDcwHighScaler).toBe(0.02);
		expect(input.aceDcwWavelet).toBe("haar");
		expect(input.aceThinking).toBe(false);
		expect(input.aceAutoDuration).toBe(true);
	});
});
