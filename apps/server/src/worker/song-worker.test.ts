import { describe, expect, it, vi } from "vitest";
import type { PlaylistWire, SongWire } from "../wire";
import {
	buildAceSubmitInput,
	SongWorker,
	type SongWorkerContext,
	type SongWorkerSettings,
} from "./song-worker";

const baseSettings: SongWorkerSettings = {
	textProvider: "openai-codex",
	textModel: "gpt-5.1",
	imageProvider: "inference-sh",
	coversEnabled: true,
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
	aceQueueDepth: 12,
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
	} as unknown as SongWire;
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

	it("passes reimagine cover-task fields through to the ACE submit input", () => {
		const song = {
			...makeSong(),
			aceTaskType: "cover",
			sourceSongId: "src-1",
			coverNoiseStrength: 0.7,
		} as unknown as SongWire;
		const input = buildAceSubmitInput({
			song,
			playlist: makePlaylist(),
			settings: baseSettings,
			srcAudioFile: "/music/src-1/audio.mp3",
		});

		expect(input.aceTaskType).toBe("cover");
		expect(input.srcAudioFile).toBe("/music/src-1/audio.mp3");
		expect(input.coverNoiseStrength).toBe(0.7);
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

describe("startCover", () => {
	function makeCoverContext(settings: SongWorkerSettings): {
		ctx: SongWorkerContext;
		enqueue: ReturnType<typeof vi.fn>;
	} {
		// Never-resolving enqueue keeps the fire-and-forget chain pending so
		// the test only observes whether the image queue was reached.
		const enqueue = vi.fn(() => new Promise(() => {}));
		const ctx = {
			queues: { image: { enqueue } },
			playlist: makePlaylist(),
			recentSongs: [],
			recentDescriptions: [],
			getPlaylistActive: async () => true,
			getSettings: async () => settings,
			capabilities: {},
		} as unknown as SongWorkerContext;
		return { ctx, enqueue };
	}

	function makeCoverSong(): SongWire {
		return {
			id: "song-cover-test",
			coverPrompt: "neon skyline album art",
			cover: null,
		} as unknown as SongWire;
	}

	it("skips the image queue entirely when coversEnabled is false", async () => {
		const { ctx, enqueue } = makeCoverContext({
			...baseSettings,
			coversEnabled: false,
		});
		const worker = new SongWorker(makeCoverSong(), ctx);
		// biome-ignore lint/complexity/useLiteralKeys: bracket access reaches the private method under test
		worker["startCover"]();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(enqueue).not.toHaveBeenCalled();
	});

	it("enqueues cover generation when coversEnabled is true", async () => {
		const { ctx, enqueue } = makeCoverContext(baseSettings);
		const worker = new SongWorker(makeCoverSong(), ctx);
		// biome-ignore lint/complexity/useLiteralKeys: bracket access reaches the private method under test
		worker["startCover"]();

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(enqueue).toHaveBeenCalledTimes(1);
	});
});
