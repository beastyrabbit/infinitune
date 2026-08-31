import { afterEach, describe, expect, it, vi } from "vitest";
import { findLrclibLyrics, type LrclibRequest } from "../external/lrclib";

interface SearchResultOverrides {
	id?: number;
	trackName?: string;
	artistName?: string;
	albumName?: string | null;
	duration?: number;
	instrumental?: boolean;
	plainLyrics?: string | null;
}

function searchResult(overrides: SearchResultOverrides = {}) {
	return {
		id: 42,
		trackName: "Dear Mr. President",
		artistName: "P!nk",
		albumName: "I'm Not Dead",
		duration: 274,
		instrumental: false,
		plainLyrics: "Dear Mr. President\nCome take a walk with me",
		...overrides,
	};
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe("findLrclibLyrics", () => {
	it("queries the fixed LRCLIB search endpoint and returns plain lyrics", async () => {
		vi.stubEnv("LRCLIB_URL", "");
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([
				searchResult({ plainLyrics: "  first line\nsecond line  " }),
			]),
		);

		const match = await findLrclibLyrics(
			{
				trackName: "Dear Mr. President",
				artistName: "P!nk",
			},
			{ request },
		);

		expect(match).toEqual({
			id: 42,
			trackName: "Dear Mr. President",
			artistName: "P!nk",
			albumName: "I'm Not Dead",
			durationSeconds: 274,
			plainLyrics: "first line\nsecond line",
		});
		expect(request).toHaveBeenCalledOnce();
		const [url, init] = request.mock.calls[0];
		expect(url.origin).toBe("https://lrclib.net");
		expect(url.pathname).toBe("/api/search");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			track_name: "Dear Mr. President",
			artist_name: "P!nk",
		});
		expect(init).toMatchObject({
			method: "GET",
			headers: {
				accept: "application/json",
				"user-agent": "Infinitune (https://git.heerlab.com/beasty/infinitune)",
				"lrclib-client":
					"Infinitune (https://git.heerlab.com/beasty/infinitune)",
			},
			redirect: "error",
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("allows LRCLIB_URL to override the deployment base URL", async () => {
		vi.stubEnv("LRCLIB_URL", "http://lrclib.test:8080/ignored-base-path");
		const request = vi.fn<LrclibRequest>(async () => jsonResponse([]));

		await findLrclibLyrics(
			{ trackName: "Song + One", artistName: "Artist & Two" },
			{ request },
		);

		const [url] = request.mock.calls[0];
		expect(url.origin).toBe("http://lrclib.test:8080");
		expect(url.pathname).toBe("/api/search");
		expect(url.searchParams.get("track_name")).toBe("Song + One");
		expect(url.searchParams.get("artist_name")).toBe("Artist & Two");
	});

	it("requires normalized exact track and artist names", async () => {
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([
				searchResult({ id: 1, trackName: "Dear Mr President" }),
				searchResult({ id: 2, artistName: "Pink" }),
				searchResult({
					id: 3,
					trackName: "  DEAR MR.   PRESIDENT ",
					artistName: " P!NK ",
				}),
			]),
		);

		const match = await findLrclibLyrics(
			{ trackName: "Dear Mr. President", artistName: "P!nk" },
			{ request },
		);

		expect(match?.id).toBe(3);
	});

	it("rejects instrumental, empty, and overlong plain lyrics", async () => {
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([
				searchResult({ id: 1, instrumental: true }),
				searchResult({ id: 2, plainLyrics: null }),
				searchResult({ id: 3, plainLyrics: " \n\t " }),
				searchResult({ id: 4, plainLyrics: "x".repeat(20_001) }),
			]),
		);

		await expect(
			findLrclibLyrics(
				{ trackName: "Dear Mr. President", artistName: "P!nk" },
				{ request },
			),
		).resolves.toBeNull();
	});

	it("uses the closest duration within the canonical two-second tolerance", async () => {
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([
				searchResult({ id: 1, duration: 102.01 }),
				searchResult({ id: 30, duration: 98 }),
				searchResult({ id: 20, duration: 99 }),
				searchResult({ id: 10, duration: 101 }),
			]),
		);

		const match = await findLrclibLyrics(
			{
				trackName: "Dear Mr. President",
				artistName: "P!nk",
				durationSeconds: 100,
			},
			{ request },
		);

		// Both 99 and 101 are one second away; the stable ID tie-break wins.
		expect(match?.id).toBe(10);
		expect(match?.durationSeconds).toBe(101);
	});

	it("accepts matches exactly two seconds from the requested duration", async () => {
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([searchResult({ duration: 102 })]),
		);

		const match = await findLrclibLyrics(
			{
				trackName: "Dear Mr. President",
				artistName: "P!nk",
				durationSeconds: 100,
			},
			{ request },
		);

		expect(match?.durationSeconds).toBe(102);
	});

	it("selects deterministically when no duration is supplied", async () => {
		const request = vi.fn<LrclibRequest>(async () =>
			jsonResponse([
				searchResult({ id: 20, duration: 275 }),
				searchResult({ id: 10, duration: 273 }),
			]),
		);

		const match = await findLrclibLyrics(
			{ trackName: "Dear Mr. President", artistName: "P!nk" },
			{ request },
		);

		expect(match?.id).toBe(10);
	});

	it.each([
		["non-success status", async () => jsonResponse([], 503)],
		["invalid JSON", async () => new Response("not-json")],
		["invalid schema", async () => jsonResponse([{ lyrics: "raw lyrics" }])],
		[
			"network failure",
			async () => {
				throw new Error("provider error containing raw lyrics");
			},
		],
	])("reduces %s to null", async (_name, implementation) => {
		const request = vi.fn<LrclibRequest>(implementation);

		await expect(
			findLrclibLyrics(
				{ trackName: "Dear Mr. President", artistName: "P!nk" },
				{ request },
			),
		).resolves.toBeNull();
	});

	it("rejects declared and streamed responses above the byte limit", async () => {
		const declaredOversize = vi.fn<LrclibRequest>(
			async () =>
				new Response("[]", { headers: { "content-length": "524289" } }),
		);
		const streamedOversize = vi.fn<LrclibRequest>(
			async () => new Response(new Uint8Array(512 * 1024 + 1)),
		);
		const query = {
			trackName: "Dear Mr. President",
			artistName: "P!nk",
		};

		await expect(
			findLrclibLyrics(query, { request: declaredOversize }),
		).resolves.toBeNull();
		await expect(
			findLrclibLyrics(query, { request: streamedOversize }),
		).resolves.toBeNull();
	});

	it("times out a request after five seconds", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		const request = vi.fn<LrclibRequest>(async (_url, init) => {
			requestSignal = init.signal as AbortSignal;
			return await new Promise<Response>(() => undefined);
		});

		const result = findLrclibLyrics(
			{ trackName: "Dear Mr. President", artistName: "P!nk" },
			{ request },
		);
		await vi.advanceTimersByTimeAsync(5_000);

		await expect(result).resolves.toBeNull();
		expect(requestSignal?.aborted).toBe(true);
	});

	it("forwards caller cancellation and returns the safe null result", async () => {
		const controller = new AbortController();
		let requestSignal: AbortSignal | undefined;
		const request = vi.fn<LrclibRequest>(async (_url, init) => {
			requestSignal = init.signal as AbortSignal;
			return await new Promise<Response>(() => undefined);
		});

		const result = findLrclibLyrics(
			{ trackName: "Dear Mr. President", artistName: "P!nk" },
			{ request, signal: controller.signal },
		);
		controller.abort(new Error("caller stopped"));

		await expect(result).resolves.toBeNull();
		expect(requestSignal?.aborted).toBe(true);
	});
});
