import { z } from "zod";

const DEFAULT_LRCLIB_URL = "https://lrclib.net";
const LRCLIB_TIMEOUT_MS = 5_000;
const LRCLIB_MAX_RESPONSE_BYTES = 512 * 1024;
const LRCLIB_MAX_LYRICS_LENGTH = 20_000;
const LRCLIB_DURATION_TOLERANCE_SECONDS = 2;
const LRCLIB_CLIENT_ID =
	"Infinitune (https://git.heerlab.com/beasty/infinitune)";

const LrclibQuerySchema = z.object({
	trackName: z.string().trim().min(1).max(500),
	artistName: z.string().trim().min(1).max(500),
	durationSeconds: z.number().finite().nonnegative().optional(),
});

const LrclibSearchResultSchema = z.object({
	id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	trackName: z.string().max(1_000),
	artistName: z.string().max(1_000),
	albumName: z.string().max(1_000).nullable().optional(),
	duration: z.number().finite().nonnegative(),
	instrumental: z.boolean(),
	plainLyrics: z.string().nullable(),
});

const LrclibSearchResponseSchema = z.array(LrclibSearchResultSchema).max(500);

export interface LrclibLyricsQuery {
	trackName: string;
	artistName: string;
	durationSeconds?: number;
}

export interface LrclibLyricsMatch {
	id: number;
	trackName: string;
	artistName: string;
	albumName: string | null;
	durationSeconds: number;
	plainLyrics: string;
}

export type LrclibRequest = (url: URL, init: RequestInit) => Promise<Response>;

export interface FindLrclibLyricsOptions {
	signal?: AbortSignal;
	/** Test seam for HTTP behavior; production callers should use the default. */
	request?: LrclibRequest;
}

interface RequestLifetime {
	signal: AbortSignal;
	dispose(): void;
}

interface RankedMatch {
	match: LrclibLyricsMatch;
	durationDelta: number;
}

function createRequestLifetime(signal?: AbortSignal): RequestLifetime {
	const controller = new AbortController();
	const abortFromCaller = () => controller.abort(signal?.reason);

	if (signal?.aborted) abortFromCaller();
	else signal?.addEventListener("abort", abortFromCaller, { once: true });

	const timeout = setTimeout(
		() => controller.abort(new Error("LRCLIB request timed out.")),
		LRCLIB_TIMEOUT_MS,
	);

	return {
		signal: controller.signal,
		dispose() {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abortFromCaller);
		},
	};
}

async function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) throw signal.reason;

	let abort: (() => void) | undefined;
	const abortPromise = new Promise<never>((_resolve, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});

	try {
		return await Promise.race([promise, abortPromise]);
	} finally {
		if (abort) signal.removeEventListener("abort", abort);
	}
}

function buildSearchUrl(trackName: string, artistName: string): URL {
	const configuredUrl = process.env.LRCLIB_URL?.trim() || DEFAULT_LRCLIB_URL;
	const baseUrl = new URL(configuredUrl);
	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new Error("LRCLIB_URL must use HTTP or HTTPS.");
	}

	const searchUrl = new URL("/api/search", baseUrl);
	searchUrl.search = new URLSearchParams({
		track_name: trackName,
		artist_name: artistName,
	}).toString();
	return searchUrl;
}

async function readBoundedResponse(
	response: Response,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const contentLength = response.headers.get("content-length")?.trim();
	if (contentLength && /^\d+$/.test(contentLength)) {
		const declaredBytes = Number(contentLength);
		if (
			!Number.isSafeInteger(declaredBytes) ||
			declaredBytes > LRCLIB_MAX_RESPONSE_BYTES
		) {
			throw new Error("LRCLIB response is too large.");
		}
	}

	if (!response.body) return new Uint8Array();

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	try {
		while (true) {
			const chunk = await abortable(reader.read(), signal);
			if (chunk.done) break;

			totalBytes += chunk.value.byteLength;
			if (totalBytes > LRCLIB_MAX_RESPONSE_BYTES) {
				void reader.cancel().catch(() => undefined);
				throw new Error("LRCLIB response is too large.");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

function normalizeExactMatch(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function compareRankedMatches(left: RankedMatch, right: RankedMatch): number {
	const deltaDifference = left.durationDelta - right.durationDelta;
	if (deltaDifference !== 0) return deltaDifference;

	const idDifference = left.match.id - right.match.id;
	if (idDifference !== 0) return idDifference;

	const durationDifference =
		left.match.durationSeconds - right.match.durationSeconds;
	if (durationDifference !== 0) return durationDifference;

	return (
		compareText(left.match.albumName ?? "", right.match.albumName ?? "") ||
		compareText(left.match.plainLyrics, right.match.plainLyrics)
	);
}

/**
 * Finds a canonical plain-lyrics match. LRCLIB and malformed-response failures
 * are intentionally reduced to `null`; response bodies and provider errors are
 * never exposed or logged from this best-effort boundary.
 */
export async function findLrclibLyrics(
	query: LrclibLyricsQuery,
	options: FindLrclibLyricsOptions = {},
): Promise<LrclibLyricsMatch | null> {
	const parsedQuery = LrclibQuerySchema.safeParse(query);
	if (!parsedQuery.success || options.signal?.aborted) return null;

	const lifetime = createRequestLifetime(options.signal);
	const request: LrclibRequest =
		options.request ?? ((url, init) => fetch(url, init));

	try {
		const url = buildSearchUrl(
			parsedQuery.data.trackName,
			parsedQuery.data.artistName,
		);
		const response = await abortable(
			request(url, {
				method: "GET",
				headers: {
					accept: "application/json",
					"user-agent": LRCLIB_CLIENT_ID,
					"lrclib-client": LRCLIB_CLIENT_ID,
				},
				redirect: "error",
				signal: lifetime.signal,
			}),
			lifetime.signal,
		);
		if (!response.ok) return null;

		const responseBytes = await readBoundedResponse(response, lifetime.signal);
		const responseText = new TextDecoder("utf-8", { fatal: true }).decode(
			responseBytes,
		);
		const parsedResponse = LrclibSearchResponseSchema.safeParse(
			JSON.parse(responseText),
		);
		if (!parsedResponse.success) return null;

		const normalizedTrackName = normalizeExactMatch(parsedQuery.data.trackName);
		const normalizedArtistName = normalizeExactMatch(
			parsedQuery.data.artistName,
		);
		const expectedDuration = parsedQuery.data.durationSeconds;
		const matches: RankedMatch[] = [];

		for (const candidate of parsedResponse.data) {
			if (
				candidate.instrumental ||
				candidate.plainLyrics === null ||
				candidate.plainLyrics.length > LRCLIB_MAX_LYRICS_LENGTH ||
				normalizeExactMatch(candidate.trackName) !== normalizedTrackName ||
				normalizeExactMatch(candidate.artistName) !== normalizedArtistName
			) {
				continue;
			}

			const plainLyrics = candidate.plainLyrics.trim();
			if (!plainLyrics) continue;

			const durationDelta =
				expectedDuration === undefined
					? 0
					: Math.abs(candidate.duration - expectedDuration);
			if (durationDelta > LRCLIB_DURATION_TOLERANCE_SECONDS) continue;

			matches.push({
				durationDelta,
				match: {
					id: candidate.id,
					trackName: candidate.trackName,
					artistName: candidate.artistName,
					albumName: candidate.albumName ?? null,
					durationSeconds: candidate.duration,
					plainLyrics,
				},
			});
		}

		matches.sort(compareRankedMatches);
		return matches[0]?.match ?? null;
	} catch {
		return null;
	} finally {
		lifetime.dispose();
	}
}
