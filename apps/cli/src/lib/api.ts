import {
	type CommandAction,
	type DeviceRegisterResponse,
	DeviceRegisterResponseSchema,
	type PlaylistSessionInfo,
	PlaylistSessionInfoSchema,
} from "@infinitune/shared/protocol";
import type { Playlist, Song, SongStatus } from "@infinitune/shared/types";
import z from "zod";

export function normalizeServerUrl(serverUrl: string): string {
	return serverUrl.replace(/\/+$/, "");
}

export function toRoomWsUrl(serverUrl: string): string {
	const base = normalizeServerUrl(serverUrl);
	if (base.startsWith("https://")) {
		return `wss://${base.slice("https://".length)}/ws/playlist`;
	}
	if (base.startsWith("http://")) {
		return `ws://${base.slice("http://".length)}/ws/playlist`;
	}
	throw new Error(`Unsupported server URL: ${serverUrl}`);
}

export function resolveMediaUrl(
	serverUrl: string,
	maybeRelative: string,
): string {
	if (/^https?:\/\//.test(maybeRelative)) return maybeRelative;
	const base = normalizeServerUrl(serverUrl);
	return `${base}${maybeRelative.startsWith("/") ? "" : "/"}${maybeRelative}`;
}

const PlaylistSchema = z
	.object({
		id: z.string(),
		createdAt: z.number(),
		name: z.string(),
		playlistKey: z.string().nullable(),
	})
	.passthrough();

const SongSchema = z
	.object({
		id: z.string(),
		createdAt: z.number(),
		playlistId: z.string(),
		orderIndex: z.number(),
		title: z.string().nullable(),
		artistName: z.string().nullable(),
		status: z.string(),
		audioUrl: z.string().nullable(),
		audioDuration: z.number().nullable(),
	})
	.passthrough();

const OkResponseSchema = z.object({
	ok: z.boolean(),
});

async function requestJson<T>(
	serverUrl: string,
	pathname: string,
	schema: z.ZodType<T>,
	init?: RequestInit,
): Promise<T> {
	const base = normalizeServerUrl(serverUrl);
	let response: Response;
	try {
		response = await fetch(`${base}${pathname}`, {
			...init,
			headers: {
				"Content-Type": "application/json",
				...(init?.headers ?? {}),
			},
		});
	} catch (error) {
		throw new Error(
			`Failed to reach ${base}${pathname}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`HTTP ${response.status} ${pathname}: ${body}`);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new Error(
			`Invalid JSON response from ${pathname}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const parsed = schema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(
			`Invalid response schema from ${pathname}: ${parsed.error.message}`,
		);
	}
	return parsed.data;
}

export function listPlaylists(serverUrl: string): Promise<Playlist[]> {
	return requestJson(serverUrl, "/api/playlists", z.array(PlaylistSchema)).then(
		(value) => value as unknown as Playlist[],
	);
}

export function getCurrentPlaylist(
	serverUrl: string,
): Promise<Playlist | null> {
	return requestJson(
		serverUrl,
		"/api/playlists/current",
		PlaylistSchema.nullable(),
	).then((value) => value as Playlist | null);
}

export function getPlaylistByKey(
	serverUrl: string,
	playlistKey: string,
): Promise<Playlist | null> {
	const encoded = encodeURIComponent(playlistKey);
	return requestJson(
		serverUrl,
		`/api/playlists/by-key/${encoded}`,
		PlaylistSchema.nullable(),
	).then((value) => value as Playlist | null);
}

export function listSongsByPlaylist(
	serverUrl: string,
	playlistId: string,
): Promise<Song[]> {
	const encoded = encodeURIComponent(playlistId);
	return requestJson(
		serverUrl,
		`/api/songs/by-playlist/${encoded}`,
		z.array(SongSchema),
	).then((value) => value as unknown as Song[]);
}

export function heartbeatPlaylist(
	serverUrl: string,
	playlistId: string,
): Promise<{ ok: boolean }> {
	const encoded = encodeURIComponent(playlistId);
	return requestJson(
		serverUrl,
		`/api/playlists/${encoded}/heartbeat`,
		OkResponseSchema,
		{
			method: "POST",
		},
	);
}

export function updatePlaylistPosition(
	serverUrl: string,
	playlistId: string,
	currentOrderIndex: number,
): Promise<{ ok: boolean }> {
	const encoded = encodeURIComponent(playlistId);
	return requestJson(
		serverUrl,
		`/api/playlists/${encoded}/position`,
		OkResponseSchema,
		{
			method: "PATCH",
			body: JSON.stringify({ currentOrderIndex }),
		},
	);
}

export function updateSongStatus(
	serverUrl: string,
	songId: string,
	status: SongStatus,
	errorMessage?: string,
): Promise<{ ok: boolean }> {
	const encoded = encodeURIComponent(songId);
	return requestJson(
		serverUrl,
		`/api/songs/${encoded}/status`,
		OkResponseSchema,
		{
			method: "PATCH",
			body: JSON.stringify({
				status,
				...(typeof errorMessage === "string" ? { errorMessage } : {}),
			}),
		},
	);
}

export function rateSong(
	serverUrl: string,
	songId: string,
	rating: "up" | "down",
): Promise<{ ok: boolean }> {
	const encoded = encodeURIComponent(songId);
	return requestJson(
		serverUrl,
		`/api/songs/${encoded}/rating`,
		OkResponseSchema,
		{
			method: "POST",
			body: JSON.stringify({ rating }),
		},
	);
}

type AuthHeaders = {
	idToken?: string;
	deviceToken?: string;
};

function resolveAuthHeaders(headers?: AuthHeaders): Record<string, string> {
	const resolved: Record<string, string> = {};
	if (headers?.idToken) {
		resolved.Authorization = `Bearer ${headers.idToken}`;
	}
	if (headers?.deviceToken) {
		resolved["x-device-token"] = headers.deviceToken;
	}
	return resolved;
}

export function getPlaylistSession(
	serverUrl: string,
	playlistId: string,
	headers?: AuthHeaders,
): Promise<PlaylistSessionInfo> {
	const encoded = encodeURIComponent(playlistId);
	return requestJson(
		serverUrl,
		`/api/v1/playlists/${encoded}/session`,
		PlaylistSessionInfoSchema,
		{
			method: "GET",
			headers: resolveAuthHeaders(headers),
		},
	);
}

export function registerDevice(
	serverUrl: string,
	deviceToken: string,
	payload?: {
		name?: string;
		daemonVersion?: string;
		capabilities?: Record<string, unknown>;
	},
): Promise<DeviceRegisterResponse> {
	return requestJson(
		serverUrl,
		"/api/v1/devices/register",
		DeviceRegisterResponseSchema,
		{
			method: "POST",
			headers: {
				"x-device-token": deviceToken,
			},
			body: JSON.stringify(payload ?? {}),
		},
	);
}

export function sendPlaylistCommand(
	serverUrl: string,
	payload: {
		playlistId: string;
		action: CommandAction;
		payload?: Record<string, unknown>;
		targetDeviceId?: string;
	},
	headers?: AuthHeaders,
): Promise<{ ok: boolean }> {
	return requestJson(serverUrl, "/api/v1/commands", OkResponseSchema, {
		method: "POST",
		headers: resolveAuthHeaders(headers),
		body: JSON.stringify(payload),
	});
}
