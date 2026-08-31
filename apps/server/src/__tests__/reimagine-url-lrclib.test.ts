import { eq } from "drizzle-orm";
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

const { downloadYoutubeAudioMock, findLrclibLyricsMock, getRequestActorMock } =
	vi.hoisted(() => ({
		downloadYoutubeAudioMock: vi.fn(),
		findLrclibLyricsMock: vi.fn(),
		getRequestActorMock: vi.fn(),
	}));

vi.mock("../auth/actor", () => ({
	getRequestActor: getRequestActorMock,
}));

vi.mock("../external/youtube-audio", () => ({
	downloadYoutubeAudio: downloadYoutubeAudioMock,
}));

vi.mock("../external/lrclib", () => ({
	findLrclibLyrics: findLrclibLyricsMock,
}));

import { songs } from "../db/schema";
import createRoutes from "../routes/songs/create";

describe("POST /reimagine-url LRCLIB lyrics", () => {
	beforeEach(() => {
		setupTestDb();
		downloadYoutubeAudioMock.mockReset();
		findLrclibLyricsMock.mockReset();
		getRequestActorMock.mockReset();
		getRequestActorMock.mockResolvedValue({ kind: "anonymous" });
		downloadYoutubeAudioMock.mockResolvedValue({
			filePath: "/tmp/dear-mr-president.mp3",
			durationSeconds: 273.6,
			title: "P!nk - Dear Mr. President",
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		teardownTestDb();
	});

	it("rejects anonymous production downloads before fetching the source", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const response = await createRoutes.request("/reimagine-url", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://www.youtube.com/watch?v=example",
				style: "acoustic protest folk",
			}),
		});

		expect(response.status).toBe(401);
		expect(downloadYoutubeAudioMock).not.toHaveBeenCalled();
	});

	it("uses exact duration-matched plain lyrics when the fallback is empty", async () => {
		findLrclibLyricsMock.mockResolvedValue({
			id: 18_713_673,
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			albumName: "I’m Not Dead",
			durationSeconds: 273.626667,
			plainLyrics: "real plain lyrics",
		});

		const response = await createRoutes.request("/reimagine-url", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://www.youtube.com/watch?v=example",
				style: "acoustic protest folk",
				sourceTrackTitle: "Dear Mr. President",
				sourceArtistName: "P!nk",
			}),
		});

		expect(response.status).toBe(200);
		expect(findLrclibLyricsMock).toHaveBeenCalledWith({
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			durationSeconds: 273.6,
		});
		const payload = (await response.json()) as { song: { id: string } };
		const [song] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, payload.song.id));
		expect(song.lyrics).toBe("real plain lyrics");
		expect(song.sourceTrackTitle).toBe("Dear Mr. President");
		expect(song.sourceArtistName).toBe("P!nk");
		expect(song.artistName).toBe("P!nk");
		expect(song.audioDuration).toBe(274);
	});

	it("keeps explicitly supplied lyrics without calling LRCLIB", async () => {
		const response = await createRoutes.request("/reimagine-url", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://www.youtube.com/watch?v=example",
				style: "acoustic protest folk",
				lyrics: "rights-approved manual lyrics",
				sourceTrackTitle: "Dear Mr. President",
				sourceArtistName: "P!nk",
			}),
		});

		expect(response.status).toBe(200);
		expect(findLrclibLyricsMock).not.toHaveBeenCalled();
		const payload = (await response.json()) as { song: { id: string } };
		const [song] = await getTestDb()
			.select()
			.from(songs)
			.where(eq(songs.id, payload.song.id));
		expect(song.lyrics).toBe("rights-approved manual lyrics");
	});

	it("does not create a cover job when an expected LRCLIB match is missing", async () => {
		findLrclibLyricsMock.mockResolvedValue(null);

		const response = await createRoutes.request("/reimagine-url", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://www.youtube.com/watch?v=example",
				style: "acoustic protest folk",
				sourceTrackTitle: "Dear Mr. President",
				sourceArtistName: "P!nk",
			}),
		});

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error:
				"No exact duration-matched LRCLIB lyrics found. Check the original title and artist, or paste lyrics manually.",
		});
		expect(await getTestDb().select().from(songs)).toEqual([]);
	});

	it("requires source title and artist together", async () => {
		const response = await createRoutes.request("/reimagine-url", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: "https://www.youtube.com/watch?v=example",
				style: "acoustic protest folk",
				sourceTrackTitle: "Dear Mr. President",
			}),
		});

		expect(response.status).toBe(400);
		expect(downloadYoutubeAudioMock).not.toHaveBeenCalled();
		expect(findLrclibLyricsMock).not.toHaveBeenCalled();
	});
});
