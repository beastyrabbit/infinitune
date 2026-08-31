import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaylistWire, SongWire } from "../wire";
import {
	blocksOwnerlessOpenRouterTextGeneration,
	buildAceSubmitInput,
	resolveSongTextLlmProfile,
	SongWorker,
	type SongWorkerContext,
	type SongWorkerSettings,
} from "./song-worker";

afterEach(() => vi.unstubAllEnvs());

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
	aceGuidanceScale: 9,
	aceSamplerMode: "euler",
	aceShift: 2,
	aceVelocityNormThreshold: 4,
	aceVelocityEmaFactor: 0.2,
	aceUseAdg: true,
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
		isTemporary: false,
		playlistKey: null,
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
		expect(input.guidanceScale).toBe(9);
		expect(input.samplerMode).toBe("euler");
		expect(input.shift).toBe(2);
		expect(input.velocityNormThreshold).toBe(4);
		expect(input.velocityEmaFactor).toBe(0.2);
		expect(input.useAdg).toBe(true);
		expect(input.aceDcwEnabled).toBe(false);
		expect(input.aceDcwMode).toBe("high");
		expect(input.aceDcwScaler).toBe(0.1);
		expect(input.aceDcwHighScaler).toBe(0.04);
		expect(input.aceDcwWavelet).toBe("db4");
		expect(input.aceThinking).toBe(true);
		expect(input.aceAutoDuration).toBe(false);
	});

	it("preserves an explicit empty global ACE model for the server default", () => {
		const input = buildAceSubmitInput({
			song: makeSong(),
			playlist: makePlaylist(),
			settings: { ...baseSettings, aceModel: "" },
		});

		expect(input.aceModel).toBe("");
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
		expect(input.guidanceScale).toBe(9);
		expect(input.samplerMode).toBe("euler");
		expect(input.shift).toBe(2);
		expect(input.velocityNormThreshold).toBe(4);
		expect(input.velocityEmaFactor).toBe(0.2);
		expect(input.useAdg).toBe(true);
		expect(input.aceDcwEnabled).toBe(true);
		expect(input.aceDcwMode).toBe("double");
		expect(input.aceDcwScaler).toBe(0.05);
		expect(input.aceDcwHighScaler).toBe(0.02);
		expect(input.aceDcwWavelet).toBe("haar");
		expect(input.aceThinking).toBe(false);
		expect(input.aceAutoDuration).toBe(true);
	});
});

describe("resolveSongTextLlmProfile", () => {
	it("uses current global settings for the hidden radio playlist", () => {
		expect(
			resolveSongTextLlmProfile({
				playlist: makePlaylist({
					mode: "radio",
					playlistKey: "global-radio",
					llmProvider: "openai-codex",
					llmModel: "gpt-5.1",
				}),
				settings: {
					...baseSettings,
					textProvider: "openrouter",
					textModel: "",
				},
			}),
		).toEqual({ provider: "openrouter", model: "auto" });
	});

	it("keeps explicit provider settings for regular playlists", () => {
		expect(
			resolveSongTextLlmProfile({
				playlist: makePlaylist({
					mode: "endless",
					llmProvider: "openai-codex",
					llmModel: "gpt-5.1",
				}),
				settings: {
					...baseSettings,
					textProvider: "openrouter",
					textModel: "auto",
				},
			}),
		).toEqual({ provider: "openai-codex", model: "gpt-5.1" });
	});
});

describe("ownerless OpenRouter production guard", () => {
	it.each([
		{
			name: "explicit production OpenRouter",
			nodeEnv: "production",
			playlist: { mode: "endless", llmProvider: "openrouter" },
			settingsProvider: "openai-codex",
			expected: true,
		},
		{
			name: "production OpenRouter from global fallback",
			nodeEnv: "production",
			playlist: { mode: "endless", llmProvider: "" },
			settingsProvider: "openrouter",
			expected: true,
		},
		{
			name: "production owned OpenRouter",
			nodeEnv: "production",
			playlist: {
				mode: "endless",
				llmProvider: "openrouter",
				ownerUserId: "user-1",
			},
			settingsProvider: "openai-codex",
			expected: false,
		},
		{
			name: "development ownerless OpenRouter",
			nodeEnv: "development",
			playlist: { mode: "endless", llmProvider: "openrouter" },
			settingsProvider: "openai-codex",
			expected: false,
		},
		{
			name: "canonical global radio",
			nodeEnv: "production",
			playlist: {
				mode: "radio",
				playlistKey: "global-radio",
				llmProvider: "openai-codex",
			},
			settingsProvider: "openrouter",
			expected: false,
		},
		{
			name: "spoofed radio playlist",
			nodeEnv: "production",
			playlist: {
				mode: "radio",
				playlistKey: "not-global-radio",
				llmProvider: "openrouter",
			},
			settingsProvider: "openrouter",
			expected: true,
		},
	] as const)("returns $expected for $name", (testCase) => {
		vi.stubEnv("NODE_ENV", testCase.nodeEnv);

		expect(
			blocksOwnerlessOpenRouterTextGeneration({
				playlist: makePlaylist(testCase.playlist),
				settings: {
					...baseSettings,
					textProvider: testCase.settingsProvider,
				},
			}),
		).toBe(testCase.expected);
	});

	it("stops before an ownerless playlist reaches metadata capabilities", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const generateMetadata = vi.fn();
		const worker = new SongWorker(
			{ id: "song-1", status: "pending" } as SongWire,
			{
				queues: {},
				playlist: makePlaylist({
					id: "playlist-1",
					mode: "endless",
					llmProvider: "openrouter",
					ownerUserId: null,
				}),
				recentSongs: [],
				recentDescriptions: [],
				getPlaylistActive: async () => true,
				getSettings: async () => baseSettings,
				capabilities: { generateMetadata },
			} as unknown as SongWorkerContext,
		);

		// biome-ignore lint/complexity/useLiteralKeys: bracket access reaches the private method under test
		await worker["generateMetadata"]();

		expect(generateMetadata).not.toHaveBeenCalled();
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
