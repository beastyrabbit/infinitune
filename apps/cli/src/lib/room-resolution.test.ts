import type { Playlist } from "@infinitune/shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
	getCurrentPlaylist: vi.fn(),
	listPlaylists: vi.fn(),
}));

vi.mock("./fzf", () => ({
	pickFromFzf: vi.fn(),
}));

import { getCurrentPlaylist, listPlaylists } from "./api";
import {
	pickExistingRoom,
	resolvePlaylist,
	resolveRoom,
} from "./room-resolution";

const playlist = {
	id: "playlist-1",
	createdAt: 1,
	name: "Private",
	playlistKey: "private",
} as Playlist;

describe("device-authenticated playlist resolution", () => {
	beforeEach(() => {
		vi.mocked(listPlaylists).mockReset().mockResolvedValue([playlist]);
		vi.mocked(getCurrentPlaylist).mockReset().mockResolvedValue(playlist);
	});

	it("forwards the device token through playlist and room lookup branches", async () => {
		const auth = { deviceToken: "device-token" };

		await resolvePlaylist("https://music.example.com", {
			explicitPlaylistKey: "private",
			...auth,
		});
		await resolveRoom("https://music.example.com", {
			explicitRoomId: "playlist-1",
			...auth,
		});
		await pickExistingRoom("https://music.example.com", auth);

		expect(listPlaylists).toHaveBeenCalledTimes(3);
		for (const [, options] of vi.mocked(listPlaylists).mock.calls) {
			expect(options).toMatchObject(auth);
		}
	});

	it("forwards the device token to current-playlist fallback", async () => {
		await resolvePlaylist("https://music.example.com", {
			interactivePlaylist: false,
			deviceToken: "device-token",
		});

		expect(getCurrentPlaylist).toHaveBeenCalledWith(
			"https://music.example.com",
			expect.objectContaining({ deviceToken: "device-token" }),
		);
	});
});
