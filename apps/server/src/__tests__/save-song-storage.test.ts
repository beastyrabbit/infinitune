import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { trimTrailingSilence, getServiceUrls } = vi.hoisted(() => ({
	trimTrailingSilence: vi.fn(),
	getServiceUrls: vi.fn(),
}));

vi.mock("../external/audio-processing", () => ({
	FFMPEG_PASS_TIMEOUT_MS: 2 * 60 * 1000,
	trimTrailingSilence,
}));
vi.mock("../external/service-urls", () => ({ getServiceUrls }));

import { saveSongToNfs } from "../external/storage";

const NO_TRIM = { trimmed: false, originalDuration: 0, trimmedDuration: 0 };

describe("saveSongToNfs", () => {
	let storageDir: string;
	let songDir: string;
	const previousEnv = {
		storage: process.env.MUSIC_STORAGE_PATH,
		prefix: process.env.ACE_NAS_PREFIX,
	};

	function save(
		overrides: Partial<Parameters<typeof saveSongToNfs>[0]> = {},
	): ReturnType<typeof saveSongToNfs> {
		return saveSongToNfs({
			songId: "song-1",
			title: "Night Drive",
			artistName: "Infinitune",
			genre: "Synthwave",
			subGenre: "Outrun",
			lyrics: "new lyrics",
			caption: "caption",
			bpm: 120,
			keyScale: "C major",
			timeSignature: "4/4",
			audioDuration: 40,
			aceAudioPath: `/v1/audio?path=${encodeURIComponent("/ace-nas/ace/out.mp3")}`,
			...overrides,
		});
	}

	const pendingFiles = () =>
		fs
			.readdirSync(songDir)
			.filter((name) => /^\.(audio|trimmed)-/.test(name))
			.sort();

	beforeEach(() => {
		storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "infinitune-save-"));
		songDir = path.join(
			storageDir,
			"Synthwave",
			"Outrun",
			"Infinitune - Night Drive",
		);
		process.env.MUSIC_STORAGE_PATH = storageDir;
		process.env.ACE_NAS_PREFIX = "/ace-nas";
		fs.mkdirSync(path.join(storageDir, "ace"));
		fs.writeFileSync(path.join(storageDir, "ace", "out.mp3"), "new audio");
		trimTrailingSilence.mockResolvedValue(NO_TRIM);
	});

	afterEach(() => {
		fs.rmSync(storageDir, { recursive: true, force: true });
		vi.clearAllMocks();
		for (const [key, value] of [
			["MUSIC_STORAGE_PATH", previousEnv.storage],
			["ACE_NAS_PREFIX", previousEnv.prefix],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("writes the audio, lyrics, log and id link", async () => {
		const result = await save();

		expect(result?.storagePath).toBe(songDir);
		expect(fs.readFileSync(path.join(songDir, "audio.mp3"), "utf8")).toBe(
			"new audio",
		);
		expect(fs.readFileSync(path.join(songDir, "lyrics.txt"), "utf8")).toBe(
			"new lyrics",
		);
		expect(fs.existsSync(path.join(songDir, "generation.log"))).toBe(true);
		expect(fs.realpathSync(path.join(storageDir, ".by-id", "song-1"))).toBe(
			fs.realpathSync(songDir),
		);
		expect(pendingFiles()).toEqual([]);
	});

	it("keeps a replacement's files when cancelled before it commits", async () => {
		// A replacement worker already saved this song into the same folder.
		fs.mkdirSync(songDir, { recursive: true });
		fs.writeFileSync(path.join(songDir, "audio.mp3"), "replacement audio");
		fs.writeFileSync(path.join(songDir, "lyrics.txt"), "replacement lyrics");

		let cancelled = false;
		trimTrailingSilence.mockImplementation(async () => {
			cancelled = true; // the worker is cancelled while its audio is trimmed
			return NO_TRIM;
		});

		await expect(save({ isCancelled: () => cancelled })).resolves.toBeNull();

		expect(fs.readFileSync(path.join(songDir, "audio.mp3"), "utf8")).toBe(
			"replacement audio",
		);
		expect(fs.readFileSync(path.join(songDir, "lyrics.txt"), "utf8")).toBe(
			"replacement lyrics",
		);
		expect(fs.existsSync(path.join(songDir, "generation.log"))).toBe(false);
		expect(fs.existsSync(path.join(storageDir, ".by-id", "song-1"))).toBe(
			false,
		);
		expect(pendingFiles()).toEqual([]);
	});

	it("removes pending audio a crashed save left, but not a live save's", async () => {
		fs.mkdirSync(songDir, { recursive: true });
		const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
		const writeFile = (name: string, aged: boolean) => {
			const file = path.join(songDir, name);
			fs.writeFileSync(file, "data");
			if (aged) fs.utimesSync(file, twentyMinutesAgo, twentyMinutesAgo);
		};
		// A crash can strand the private audio or the trim's second-pass output.
		writeFile(".audio-0b6b3c4e-5f1a-4d2b-9c3e-1a2b3c4d5e6f.mp3", true);
		writeFile(".trimmed-1790000000000.mp3", true);
		// Live saves and files this code did not create stay.
		writeFile(".audio-7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f.mp3", false);
		writeFile(".trimmed-1790000900000.mp3", false);
		writeFile(".trimmed-user.mp3", true);

		await save();

		expect(pendingFiles()).toEqual([
			".audio-7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f.mp3",
			".trimmed-1790000900000.mp3",
			".trimmed-user.mp3",
		]);
	});

	it("removes the pending audio when the download fails", async () => {
		getServiceUrls.mockResolvedValue({ aceStepUrl: "http://127.0.0.1:9" });

		await expect(
			save({ aceAudioPath: "/v1/audio?path=%2Felsewhere%2Fout.mp3" }),
		).rejects.toThrow();

		expect(fs.existsSync(path.join(songDir, "audio.mp3"))).toBe(false);
		expect(pendingFiles()).toEqual([]);
	});
});
