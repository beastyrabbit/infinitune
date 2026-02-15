/**
 * Browser-side API client. Thin wrapper around fetch for the Hono API server.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5175";

async function get<T>(path: string): Promise<T> {
	const res = await fetch(`${API_URL}${path}`);
	if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`PATCH ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, { method: "DELETE" });
	if (!res.ok) throw new Error(`DELETE ${path}: ${res.status}`);
	return res.json() as Promise<T>;
}

export const api = { get, post, patch, del };
export { API_URL };
