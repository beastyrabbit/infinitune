/**
 * Centralized endpoint URLs for the Infinitune API server.
 *
 * Resolution order:
 *   1. VITE_API_URL (baked at build time by Vite, available via import.meta.env in browser)
 *   2. process.env.VITE_API_URL (available during SSR / Nitro)
 *   3. Fallback to localhost:5175 (local dev)
 */

function resolveApiUrl(): string {
	// Browser / Vite client bundle
	if (typeof import.meta.env?.VITE_API_URL === "string") {
		return import.meta.env.VITE_API_URL;
	}
	// SSR (Nitro) — process.env is available
	// biome-ignore lint/complexity/useOptionalChain: typeof guard needed for undeclared global
	if (typeof process !== "undefined" && process.env?.VITE_API_URL) {
		return process.env.VITE_API_URL;
	}
	return "http://localhost:5175";
}

/** Base HTTP URL for the API server (no trailing slash). */
export const API_URL: string = resolveApiUrl();

/** WebSocket URL for the event invalidation bridge (/ws). */
export const EVENT_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws`;

/** WebSocket URL for the room protocol (/ws/room). */
export const ROOM_WS_URL: string = `${API_URL.replace(/^http/, "ws")}/ws/room`;
