import type { SongCover } from "@/types";

/**
 * Centralized endpoint URLs for the Infinitune API server.
 *
 * Browser requests stay same-origin unless VITE_API_URL explicitly selects a
 * split API. During SSR, APP_ORIGIN remains the public base used in rendered
 * media URLs while INTERNAL_API_URL may select a private API endpoint for the
 * loader fetch itself.
 */

const LOCAL_API_URL = "http://localhost:5175";

export interface ApiUrlSources {
	viteApiUrl?: string;
	processViteApiUrl?: string;
	appOrigin?: string;
	internalApiUrl?: string;
	browserOrigin?: string;
}

function cleanBaseUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

/** Pure URL selection kept separate so SSR and browser behavior stay tested. */
export function selectApiUrls(sources: ApiUrlSources): {
	publicApiUrl: string;
	fetchApiUrl: string;
} {
	const viteApiUrl =
		cleanBaseUrl(sources.viteApiUrl) ?? cleanBaseUrl(sources.processViteApiUrl);
	const browserOrigin = cleanBaseUrl(sources.browserOrigin);
	const publicApiUrl = browserOrigin
		? (viteApiUrl ?? browserOrigin)
		: (cleanBaseUrl(sources.appOrigin) ?? viteApiUrl ?? LOCAL_API_URL);
	const fetchApiUrl = browserOrigin
		? publicApiUrl
		: (cleanBaseUrl(sources.internalApiUrl) ?? publicApiUrl);

	return { publicApiUrl, fetchApiUrl };
}

const processEnv = typeof process !== "undefined" ? process.env : undefined;
const runtimeApiUrls = selectApiUrls({
	viteApiUrl: import.meta.env?.VITE_API_URL,
	processViteApiUrl: processEnv?.VITE_API_URL,
	appOrigin: processEnv?.APP_ORIGIN,
	internalApiUrl: processEnv?.INTERNAL_API_URL,
	browserOrigin:
		typeof window !== "undefined" ? window.location.origin : undefined,
});

/** Base HTTP URL for the API server (no trailing slash). */
export const API_URL: string = runtimeApiUrls.publicApiUrl;

/** HTTP base used by loaders. It differs from API_URL only during SSR. */
export const API_FETCH_URL: string = runtimeApiUrls.fetchApiUrl;

/** WebSocket URL for the event invalidation bridge (/ws). */
export const EVENT_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws`;

/** WebSocket URL for the playlist-session protocol (/ws/playlist). */
export const ROOM_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws/playlist`;

/** WebSocket URL for the global radio protocol (/ws/radio). */
export const RADIO_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws/radio`;

/**
 * Resolves media URLs from API payloads.
 * Relative paths (e.g. `/api/songs/:id/audio`) are resolved against API_URL.
 */
export function resolveApiMediaUrl(
	url: string | null | undefined,
): string | null {
	if (!url) return null;
	if (url.startsWith("data:") || url.startsWith("blob:")) return url;
	try {
		return new URL(url, API_URL).toString();
	} catch {
		return url;
	}
}

export function resolveSongCover(
	cover: SongCover | null | undefined,
): SongCover | null {
	if (!cover) return null;
	return {
		jxlUrl: resolveApiMediaUrl(cover.jxlUrl),
		webpUrl: resolveApiMediaUrl(cover.webpUrl),
		pngUrl: resolveApiMediaUrl(cover.pngUrl),
	};
}
