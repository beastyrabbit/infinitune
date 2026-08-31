import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getCurrentPlaylist,
	getPlaylistByKey,
	heartbeatPlaylist,
	listPlaylists,
	listSongsByPlaylist,
	rateSong,
	updatePlaylistPosition,
	updateSongStatus,
} from "./api";

const playlist = {
	id: "playlist-1",
	createdAt: 1,
	name: "Private",
	playlistKey: "private",
};
const song = {
	id: "song-1",
	createdAt: 1,
	playlistId: "playlist-1",
	orderIndex: 1,
	title: "Song",
	artistName: "Artist",
	status: "ready",
	audioUrl: "/api/songs/song-1/audio",
	audioDuration: 120,
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("legacy playback API authentication", () => {
	it("sends the configured device token on every local playback request", async () => {
		const fetchMock = vi.fn(
			async (input: string | URL | Request, _init?: RequestInit) => {
				const pathname = new URL(String(input)).pathname;
				const payload = pathname.includes("/api/songs/by-playlist")
					? [song]
					: pathname === "/api/playlists" ||
							pathname === "/api/playlists/current" ||
							pathname.includes("/api/playlists/by-key/")
						? pathname === "/api/playlists"
							? [playlist]
							: playlist
						: { ok: true };
				return new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		const auth = { deviceToken: "device-token" };

		await listPlaylists("https://music.example.com", auth);
		await getCurrentPlaylist("https://music.example.com", auth);
		await getPlaylistByKey("https://music.example.com", "private", auth);
		await listSongsByPlaylist("https://music.example.com", "playlist-1", auth);
		await heartbeatPlaylist("https://music.example.com", "playlist-1", auth);
		await updatePlaylistPosition(
			"https://music.example.com",
			"playlist-1",
			1,
			auth,
		);
		await updateSongStatus(
			"https://music.example.com",
			"song-1",
			"played",
			undefined,
			auth,
		);
		await rateSong("https://music.example.com", "song-1", "up", auth);

		expect(fetchMock).toHaveBeenCalledTimes(8);
		for (const [, init] of fetchMock.mock.calls) {
			expect(new Headers(init?.headers).get("x-device-token")).toBe(
				"device-token",
			);
		}
	});
});
