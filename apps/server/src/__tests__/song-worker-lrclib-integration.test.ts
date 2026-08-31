import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: vi.fn(),
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

const { downloadAudioBySearchMock, findLrclibLyricsMock } = vi.hoisted(() => ({
	downloadAudioBySearchMock: vi.fn(),
	findLrclibLyricsMock: vi.fn(),
}));

vi.mock("../external/youtube-audio", () => ({
	downloadAudioBySearch: downloadAudioBySearchMock,
	downloadYoutubeAudio: vi.fn(),
}));

vi.mock("../external/lrclib", () => ({
	findLrclibLyrics: findLrclibLyricsMock,
}));

import { playlists, songs } from "../db/schema";
import * as songService from "../services/song-service";
import { playlistToWire, songToWire } from "../wire";
import {
	SongWorker,
	type SongWorkerContext,
	type SongWorkerSettings,
} from "../worker/song-worker";

const settings: SongWorkerSettings = {
	textProvider: "openrouter",
	textModel: "auto",
	imageProvider: "inference-sh",
	coversEnabled: false,
	aceModel: "acestep-v15-xl-sft",
	aceInferenceSteps: 50,
	aceLmTemperature: 0.85,
	aceLmCfgScale: 2.5,
	aceInferMethod: "ode",
	aceGuidanceScale: 7,
	aceSamplerMode: "heun",
	aceShift: 1,
	aceVelocityNormThreshold: 2,
	aceVelocityEmaFactor: 0.1,
	aceUseAdg: false,
	aceDcwEnabled: false,
	aceDcwMode: "double",
	aceDcwScaler: 0.05,
	aceDcwHighScaler: 0.02,
	aceDcwWavelet: "haar",
	aceThinking: false,
	aceAutoDuration: false,
	aceQueueDepth: 12,
	personaProvider: "openrouter",
	personaModel: "auto",
};

describe("SongWorker automatic cover lyrics", () => {
	let tempDir: string;
	let sourceAudioPath: string;

	beforeEach(() => {
		setupTestDb();
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "infinitune-cover-lyrics-"),
		);
		sourceAudioPath = path.join(tempDir, "source.mp3");
		fs.writeFileSync(sourceAudioPath, "test audio placeholder");
		downloadAudioBySearchMock.mockReset();
		findLrclibLyricsMock.mockReset();
		downloadAudioBySearchMock.mockResolvedValue({
			filePath: sourceAudioPath,
			durationSeconds: 273.6,
			title: "P!nk - Dear Mr. President",
		});
	});

	afterEach(() => {
		teardownTestDb();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function runAutomaticCover(fallbackLyrics: string) {
		const db = getTestDb();
		const [playlist] = await db
			.insert(playlists)
			.values({
				name: "Automatic covers",
				prompt: "Acoustic protest folk",
				llmProvider: "openrouter",
				llmModel: "auto",
				mode: "radio",
				status: "active",
				songsGenerated: 0,
				promptEpoch: 0,
				isTemporary: false,
			})
			.returning();
		const [song] = await db
			.insert(songs)
			.values({
				playlistId: playlist.id,
				orderIndex: 1,
				status: "metadata_ready",
				title: "Dear Mr. President (Acoustic Cover)",
				artistName: "Infinitune",
				genre: "acoustic folk",
				lyrics: fallbackLyrics,
				caption: "Acoustic protest folk with close vocals",
				vocalStyle: "intimate duet",
				bpm: 84,
				keyScale: "G major",
				timeSignature: "4/4",
				audioDuration: 274,
				aceTaskType: "cover",
				sourceUrl: "ytsearch1:Dear Mr. President P!nk official audio",
				sourceTrackTitle: "Dear Mr. President",
				sourceArtistName: "P!nk",
				coverNoiseStrength: 0.5,
			})
			.returning();

		const submitAudio = vi.fn(async (_input: unknown) => ({
			taskId: "ace-task-1",
		}));
		const enqueue = vi.fn(
			async (request: {
				execute: (signal: AbortSignal) => Promise<unknown>;
			}) => ({
				result: await request.execute(new AbortController().signal),
				processingMs: 11,
			}),
		);
		const worker = new SongWorker(songToWire(song), {
			queues: { audio: { enqueue } },
			playlist: playlistToWire(playlist),
			recentSongs: [],
			recentDescriptions: [],
			getPlaylistActive: async () => true,
			getSettings: async () => settings,
			capabilities: { submitAudio },
		} as unknown as SongWorkerContext);

		// biome-ignore lint/complexity/useLiteralKeys: bracket access reaches the private integration boundary under test
		await worker["submitAndPollAudio"]();

		return {
			persisted: await songService.getById(song.id),
			submitAudio,
		};
	}

	it("persists duration-matched LRCLIB lyrics before submitting them to ACE", async () => {
		findLrclibLyricsMock.mockResolvedValue({
			id: 18_713_673,
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			albumName: "I'm Not Dead",
			durationSeconds: 273.626667,
			plainLyrics: "canonical LRCLIB lyrics",
		});

		const { persisted, submitAudio } = await runAutomaticCover(
			"generated fallback lyrics",
		);

		expect(downloadAudioBySearchMock).toHaveBeenCalledWith(
			"ytsearch1:Dear Mr. President P!nk official audio",
		);
		expect(findLrclibLyricsMock).toHaveBeenCalledWith({
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			durationSeconds: 273.6,
		});
		expect(persisted?.lyrics).toBe("canonical LRCLIB lyrics");
		expect(persisted?.sourceAudioPath).toBe(sourceAudioPath);
		expect(submitAudio).toHaveBeenCalledOnce();
		expect(submitAudio.mock.calls[0]?.[0]).toMatchObject({
			lyrics: "canonical LRCLIB lyrics",
			aceTaskType: "cover",
			srcAudioFile: sourceAudioPath,
		});
	});

	it("keeps and submits fallback lyrics when LRCLIB has no exact match", async () => {
		findLrclibLyricsMock.mockResolvedValue(null);

		const { persisted, submitAudio } = await runAutomaticCover(
			"generated fallback lyrics",
		);

		expect(findLrclibLyricsMock).toHaveBeenCalledWith({
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			durationSeconds: 273.6,
		});
		expect(persisted?.lyrics).toBe("generated fallback lyrics");
		expect(submitAudio).toHaveBeenCalledOnce();
		expect(submitAudio.mock.calls[0]?.[0]).toMatchObject({
			lyrics: "generated fallback lyrics",
			aceTaskType: "cover",
			srcAudioFile: sourceAudioPath,
		});
	});
});
