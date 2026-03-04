/**
 * Browser-side API client. Thin wrapper around fetch for the Hono API server.
 */

import { API_URL } from "@/lib/endpoints";

export const SHOO_ID_TOKEN_STORAGE_KEY = "infinitune-shoo-id-token";
const AUTH_GATEWAY_HOST = "pangolin.heerlab.com";

export function getStoredShooIdToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		const token = window.localStorage.getItem(SHOO_ID_TOKEN_STORAGE_KEY);
		if (!token) return null;
		const trimmed = token.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

export function setStoredShooIdToken(token: string): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(SHOO_ID_TOKEN_STORAGE_KEY, token.trim());
}

export function clearStoredShooIdToken(): void {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(SHOO_ID_TOKEN_STORAGE_KEY);
}

async function extractErrorMessage(
	res: Response,
	fallback: string,
): Promise<string> {
	// redirect: "manual" produces opaque redirect responses for cross-origin 3xx
	if (res.type === "opaqueredirect" || (res.status === 0 && !res.ok)) {
		return `${fallback}: redirected to auth gateway (try refreshing the page)`;
	}

	try {
		const body = (await res.json()) as Record<string, unknown>;
		if (typeof body.error === "string") return body.error;
		if (typeof body.message === "string") return body.message;
	} catch {
		// Response body is not JSON
	}

	if (res.status >= 300 && res.status < 400) {
		const location = res.headers.get("location");
		if (location?.includes(`${AUTH_GATEWAY_HOST}/auth/resource`)) {
			return `${fallback}: redirected to auth gateway (${location})`;
		}
		return `${fallback}: redirected (${res.status} ${res.statusText})`;
	}

	return `${fallback}: ${res.status}`;
}

function buildHeaders(
	headers?: HeadersInit,
	withJsonContentType = false,
): Headers {
	const merged = new Headers(headers);
	if (withJsonContentType && !merged.has("Content-Type")) {
		merged.set("Content-Type", "application/json");
	}
	const idToken = getStoredShooIdToken();
	if (idToken && !merged.has("Authorization")) {
		merged.set("Authorization", `Bearer ${idToken}`);
	}
	return merged;
}

export interface ApiRequestOptions {
	/** Total timeout in ms across all attempts (creates an AbortController internally) */
	timeoutMs?: number;
	/** Number of retries on transient network errors. GET defaults to 2, mutations default to 0.
	 *  Only set retries > 0 on POST/PATCH/DELETE if the endpoint is idempotent. */
	retries?: number;
}

/** Returns true for transient network-level errors (no HTTP response received). */
function isNetworkError(error: unknown): boolean {
	if (!(error instanceof TypeError)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes("failed to fetch") ||
		msg.includes("networkerror") ||
		msg.includes("load failed") ||
		msg.includes("network request failed")
	);
}

/** Check whether an error is a timeout-triggered AbortError (not a caller abort). */
export function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error) || error.name !== "AbortError") return false;
	const reason = (error as DOMException & { reason?: unknown }).reason;
	return reason === "timeout" || reason === undefined;
}

/** Extract a human-readable message from an error. */
export function getRequestErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Unknown error";
}

async function fetchWithRetry(
	url: string,
	init: RequestInit,
	retries: number,
): Promise<Response> {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fetch(url, init);
		} catch (error) {
			// Only retry on transient network errors, not aborts/timeouts
			if (!isNetworkError(error) || attempt === retries) {
				throw error;
			}
			// Exponential backoff with jitter: ~500ms, ~1000ms
			const delay = (attempt + 1) * 500 + Math.random() * 200;
			await new Promise<void>((resolve) => {
				const backoffTimer = setTimeout(resolve, delay);
				init.signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(backoffTimer);
						resolve();
					},
					{ once: true },
				);
			});
		}
	}
	// Unreachable — the loop always returns or throws
	throw new Error("fetchWithRetry: unexpected end of retry loop");
}

function applyTimeout(
	init: RequestInit,
	options?: ApiRequestOptions,
): { init: RequestInit; cleanup: () => void } {
	if (!options?.timeoutMs) return { init, cleanup: () => {} };
	const controller = new AbortController();
	const timer = window.setTimeout(
		() => controller.abort("timeout"),
		options.timeoutMs,
	);
	// If caller already set a signal, chain them
	let onExternalAbort: (() => void) | undefined;
	if (init.signal) {
		if (init.signal.aborted) {
			controller.abort(init.signal.reason);
		} else {
			onExternalAbort = () => controller.abort(init.signal?.reason);
			init.signal.addEventListener("abort", onExternalAbort);
		}
	}
	return {
		init: { ...init, signal: controller.signal },
		cleanup: () => {
			window.clearTimeout(timer);
			if (onExternalAbort && init.signal) {
				init.signal.removeEventListener("abort", onExternalAbort);
			}
		},
	};
}

async function get<T>(
	path: string,
	init?: RequestInit,
	options?: ApiRequestOptions,
): Promise<T> {
	const retries = options?.retries ?? 2;
	// Headers (including Authorization) are captured once before retries.
	const { init: finalInit, cleanup } = applyTimeout(
		{
			...init,
			redirect: "manual" as const,
			headers: buildHeaders(init?.headers, false),
		},
		options,
	);
	try {
		const res = await fetchWithRetry(`${API_URL}${path}`, finalInit, retries);
		if (!res.ok) throw new Error(await extractErrorMessage(res, `GET ${path}`));
		return res.json() as Promise<T>;
	} finally {
		cleanup();
	}
}

async function post<T>(
	path: string,
	body?: unknown,
	init?: Omit<RequestInit, "body" | "method">,
	options?: ApiRequestOptions,
): Promise<T> {
	const retries = options?.retries ?? 0;
	const { init: finalInit, cleanup } = applyTimeout(
		{
			...init,
			method: "POST",
			redirect: "manual" as const,
			headers: buildHeaders(init?.headers, true),
			body: body !== undefined ? JSON.stringify(body) : undefined,
		},
		options,
	);
	try {
		const res = await fetchWithRetry(`${API_URL}${path}`, finalInit, retries);
		if (!res.ok)
			throw new Error(await extractErrorMessage(res, `POST ${path}`));
		return res.json() as Promise<T>;
	} finally {
		cleanup();
	}
}

async function patch<T>(
	path: string,
	body: unknown,
	init?: Omit<RequestInit, "body" | "method">,
	options?: ApiRequestOptions,
): Promise<T> {
	const retries = options?.retries ?? 0;
	const { init: finalInit, cleanup } = applyTimeout(
		{
			...init,
			method: "PATCH",
			redirect: "manual" as const,
			headers: buildHeaders(init?.headers, true),
			body: JSON.stringify(body),
		},
		options,
	);
	try {
		const res = await fetchWithRetry(`${API_URL}${path}`, finalInit, retries);
		if (!res.ok)
			throw new Error(await extractErrorMessage(res, `PATCH ${path}`));
		return res.json() as Promise<T>;
	} finally {
		cleanup();
	}
}

async function del<T>(
	path: string,
	init?: Omit<RequestInit, "method">,
	options?: ApiRequestOptions,
): Promise<T> {
	const retries = options?.retries ?? 0;
	const { init: finalInit, cleanup } = applyTimeout(
		{
			...init,
			method: "DELETE",
			redirect: "manual" as const,
			headers: buildHeaders(init?.headers, false),
		},
		options,
	);
	try {
		const res = await fetchWithRetry(`${API_URL}${path}`, finalInit, retries);
		if (!res.ok)
			throw new Error(await extractErrorMessage(res, `DELETE ${path}`));
		return res.json() as Promise<T>;
	} finally {
		cleanup();
	}
}

export const api = { get, post, patch, del };
export { API_URL };
