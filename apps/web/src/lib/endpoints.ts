/**
 * Centralized endpoint URLs for the Infinitune API server.
 *
 * Resolution order:
 *   1. VITE_API_URL (baked at build time by Vite, available via import.meta.env in browser)
 *   2. process.env.VITE_API_URL (available during SSR / Nitro)
 *   3. window.location.origin (browser same-origin — works behind reverse proxy)
 *   4. Fallback to localhost:5175 (local dev without env, SSR without env)
 */

function resolveApiUrl(): string {
	// Explicit override via env var (local dev, split deployments)
	const envUrl = import.meta.env?.VITE_API_URL;
	if (typeof envUrl === "string" && envUrl.length > 0) {
		console.info("[endpoints] API_URL from VITE_API_URL:", envUrl);
		return envUrl;
	}
	// SSR (Nitro) — process.env is available
	// biome-ignore lint/complexity/useOptionalChain: typeof guard needed for undeclared global
	if (typeof process !== "undefined" && process.env?.VITE_API_URL) {
		console.info(
			"[endpoints] API_URL from process.env:",
			process.env.VITE_API_URL,
		);
		return process.env.VITE_API_URL;
	}
	// Browser: same-origin (API served from same host via reverse proxy)
	if (typeof window !== "undefined") {
		console.info(
			"[endpoints] API_URL from window.location.origin:",
			window.location.origin,
		);
		return window.location.origin;
	}
	// Final fallback (local dev without env, SSR without env)
	console.warn("[endpoints] API_URL falling back to http://localhost:5175");
	return "http://localhost:5175";
}

/** Base HTTP URL for the API server (no trailing slash). */
export const API_URL: string = resolveApiUrl();

/** WebSocket URL for the event invalidation bridge (/ws). */
export const EVENT_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws`;

/** WebSocket URL for the room protocol (/ws/room). */
export const ROOM_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws/room`;

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
