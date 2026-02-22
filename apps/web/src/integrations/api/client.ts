/**
 * Browser-side API client. Thin wrapper around fetch for the Hono API server.
 */

import { API_URL } from "@/lib/endpoints";

export const SHOO_ID_TOKEN_STORAGE_KEY = "infinitune-shoo-id-token";

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
	try {
		const body = (await res.json()) as Record<string, unknown>;
		if (typeof body.error === "string") return body.error;
		if (typeof body.message === "string") return body.message;
	} catch {
		// Response body is not JSON
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

async function get<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		...init,
		headers: buildHeaders(init?.headers, false),
	});
	if (!res.ok) throw new Error(await extractErrorMessage(res, `GET ${path}`));
	return res.json() as Promise<T>;
}

async function post<T>(
	path: string,
	body?: unknown,
	init?: Omit<RequestInit, "body" | "method">,
): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		...init,
		method: "POST",
		headers: buildHeaders(init?.headers, true),
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(await extractErrorMessage(res, `POST ${path}`));
	return res.json() as Promise<T>;
}

async function patch<T>(
	path: string,
	body: unknown,
	init?: Omit<RequestInit, "body" | "method">,
): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		...init,
		method: "PATCH",
		headers: buildHeaders(init?.headers, true),
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(await extractErrorMessage(res, `PATCH ${path}`));
	return res.json() as Promise<T>;
}

async function del<T>(
	path: string,
	init?: Omit<RequestInit, "method">,
): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		...init,
		method: "DELETE",
		headers: buildHeaders(init?.headers, false),
	});
	if (!res.ok)
		throw new Error(await extractErrorMessage(res, `DELETE ${path}`));
	return res.json() as Promise<T>;
}

export const api = { get, post, patch, del };
export { API_URL };
