import type { NowPlayingResponse, RoomInfo } from "@infinitune/shared/protocol";
import type { Playlist } from "@infinitune/shared/types";

export function normalizeServerUrl(serverUrl: string): string {
	return serverUrl.replace(/\/+$/, "");
}

export function toRoomWsUrl(serverUrl: string): string {
	const base = normalizeServerUrl(serverUrl);
	if (base.startsWith("https://")) {
		return `wss://${base.slice("https://".length)}/ws/room`;
	}
	if (base.startsWith("http://")) {
		return `ws://${base.slice("http://".length)}/ws/room`;
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

async function requestJson<T>(
	serverUrl: string,
	pathname: string,
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
	return (await response.json()) as T;
}

export function listPlaylists(serverUrl: string): Promise<Playlist[]> {
	return requestJson<Playlist[]>(serverUrl, "/api/playlists");
}

export function getCurrentPlaylist(
	serverUrl: string,
): Promise<Playlist | null> {
	return requestJson<Playlist | null>(serverUrl, "/api/playlists/current");
}

export function listRooms(serverUrl: string): Promise<RoomInfo[]> {
	return requestJson<RoomInfo[]>(serverUrl, "/api/v1/rooms");
}

export function createRoom(
	serverUrl: string,
	payload: { id: string; name: string; playlistKey: string },
): Promise<{ id: string; name: string; playlistKey: string }> {
	return requestJson<{ id: string; name: string; playlistKey: string }>(
		serverUrl,
		"/api/v1/rooms",
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);
}

export function getNowPlaying(
	serverUrl: string,
	roomId: string,
): Promise<NowPlayingResponse> {
	const encoded = encodeURIComponent(roomId);
	return requestJson<NowPlayingResponse>(
		serverUrl,
		`/api/v1/now-playing?room=${encoded}`,
	);
}
