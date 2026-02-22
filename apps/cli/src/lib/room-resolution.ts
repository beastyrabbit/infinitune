import type { Playlist } from "@infinitune/shared/types";
import { getCurrentPlaylist, listPlaylists } from "./api";
import { pickFromFzf } from "./fzf";

export type ResolvePlaylistOptions = {
	explicitPlaylistKey?: string;
	defaultPlaylistKey?: string | null;
	interactivePlaylist?: boolean;
};

export type PlaylistRoom = {
	id: string;
	name: string;
	playlistId: string;
	playlistKey: string;
	deviceCount: number;
};

export type ResolvedRoom = {
	room: PlaylistRoom;
	playlist: Playlist | null;
	created: boolean;
};

export type ResolveRoomOptions = {
	explicitRoomId?: string;
	explicitPlaylistKey?: string;
	defaultRoomId?: string | null;
	defaultPlaylistKey?: string | null;
	interactivePlaylist?: boolean;
};

function toPlaylistRoom(playlist: Playlist): PlaylistRoom {
	const name = playlist.name.trim() || playlist.playlistKey || playlist.id;
	return {
		id: playlist.id,
		name,
		playlistId: playlist.id,
		playlistKey: playlist.playlistKey ?? playlist.id,
		deviceCount: 0,
	};
}

export async function pickPlaylistInteractive(
	serverUrl: string,
): Promise<Playlist> {
	const playlists = await listPlaylists(serverUrl);
	if (playlists.length === 0) {
		throw new Error("No playlists found on server.");
	}

	const sorted = [...playlists].sort((a, b) => b.createdAt - a.createdAt);
	const lines = sorted.map((playlist) => {
		const name = playlist.name.trim() || "(untitled playlist)";
		const playlistKey = playlist.playlistKey ?? "-";
		return `${playlist.id}\t${name}\t${playlistKey}`;
	});

	const picked = pickFromFzf(lines, {
		prompt: "playlist",
		header: "playlist | key",
		delimiter: "\t",
		withNth: "2..",
	});
	if (!picked) {
		throw new Error("Playlist selection cancelled.");
	}
	const id = picked.split("\t")[0];
	const playlist = sorted.find((entry) => entry.id === id);
	if (!playlist) {
		throw new Error("Failed to resolve selected playlist.");
	}
	return playlist;
}

export async function resolvePlaylist(
	serverUrl: string,
	options: ResolvePlaylistOptions,
): Promise<Playlist> {
	const playlists = await listPlaylists(serverUrl);
	if (playlists.length === 0) {
		throw new Error("No playlists found on server.");
	}

	if (options.explicitPlaylistKey) {
		const playlist = playlists.find(
			(entry) => entry.playlistKey === options.explicitPlaylistKey,
		);
		if (!playlist) {
			throw new Error(
				`Playlist with key "${options.explicitPlaylistKey}" not found.`,
			);
		}
		return playlist;
	}

	if (options.defaultPlaylistKey) {
		const playlist = playlists.find(
			(entry) => entry.playlistKey === options.defaultPlaylistKey,
		);
		if (playlist) {
			return playlist;
		}
	}

	if (options.interactivePlaylist === false) {
		const current = await getCurrentPlaylist(serverUrl);
		if (!current) {
			throw new Error(
				"No current playlist found and interactive mode is disabled.",
			);
		}
		return current;
	}

	return pickPlaylistInteractive(serverUrl);
}

async function pickRoomInteractive(
	rooms: PlaylistRoom[],
): Promise<PlaylistRoom> {
	const lines = rooms.map((room) => {
		return `${room.id}\t${room.name}\t${room.playlistKey}`;
	});
	const picked = pickFromFzf(lines, {
		prompt: "playlist-session",
		header: "name | key",
		delimiter: "\t",
		withNth: "2..",
	});
	if (!picked) {
		throw new Error("Playlist session selection cancelled.");
	}
	const id = picked.split("\t")[0];
	const room = rooms.find((entry) => entry.id === id);
	if (!room) {
		throw new Error("Failed to resolve selected playlist session.");
	}
	return room;
}

async function ensureRoomForPlaylist(
	playlist: Playlist,
): Promise<ResolvedRoom> {
	return {
		room: toPlaylistRoom(playlist),
		playlist,
		created: false,
	};
}

async function resolveByRoomId(
	serverUrl: string,
	roomId: string,
): Promise<ResolvedRoom> {
	const playlists = await listPlaylists(serverUrl);
	const playlist =
		playlists.find((entry) => entry.id === roomId) ??
		playlists.find((entry) => entry.playlistKey === roomId) ??
		null;
	if (!playlist) {
		throw new Error(`Playlist session "${roomId}" not found.`);
	}
	return ensureRoomForPlaylist(playlist);
}

async function resolveByPlaylistKey(
	serverUrl: string,
	playlistKey: string,
): Promise<ResolvedRoom> {
	const playlists = await listPlaylists(serverUrl);
	const playlist =
		playlists.find((entry) => entry.playlistKey === playlistKey) ?? null;
	if (!playlist) {
		throw new Error(`Playlist with key "${playlistKey}" not found.`);
	}
	return ensureRoomForPlaylist(playlist);
}

export async function resolveRoom(
	serverUrl: string,
	options: ResolveRoomOptions,
): Promise<ResolvedRoom> {
	if (options.explicitRoomId) {
		return resolveByRoomId(serverUrl, options.explicitRoomId);
	}

	if (options.explicitPlaylistKey) {
		return resolveByPlaylistKey(serverUrl, options.explicitPlaylistKey);
	}

	if (options.defaultRoomId) {
		try {
			return await resolveByRoomId(serverUrl, options.defaultRoomId);
		} catch {
			// Fallback below.
		}
	}

	if (options.defaultPlaylistKey) {
		try {
			return await resolveByPlaylistKey(serverUrl, options.defaultPlaylistKey);
		} catch {
			// Fallback below.
		}
	}

	if (options.interactivePlaylist === false) {
		const current = await getCurrentPlaylist(serverUrl);
		if (!current) {
			throw new Error(
				"No current playlist found and interactive mode is disabled.",
			);
		}
		return ensureRoomForPlaylist(current);
	}

	const playlist = await pickPlaylistInteractive(serverUrl);
	return ensureRoomForPlaylist(playlist);
}

export async function pickExistingRoom(
	serverUrl: string,
): Promise<PlaylistRoom> {
	const playlists = await listPlaylists(serverUrl);
	if (playlists.length === 0) {
		throw new Error("No playlists available.");
	}
	const rooms = playlists
		.sort((a, b) => b.createdAt - a.createdAt)
		.map((playlist) => toPlaylistRoom(playlist));
	if (rooms.length === 1) return rooms[0];
	return pickRoomInteractive(rooms);
}

export function pickSongFromQueue(
	queue: Array<{
		id: string;
		title?: string;
		artistName?: string;
		status: string;
	}>,
): string {
	if (queue.length === 0) {
		throw new Error("Queue is empty.");
	}

	const lines = queue.map((song) => {
		const title = song.title ?? "Untitled";
		const artist = song.artistName ?? "Unknown";
		return `${song.id}\t${title}\t${artist}\t${song.status}`;
	});
	const picked = pickFromFzf(lines, {
		prompt: "song",
		header: "title | artist | status",
		delimiter: "\t",
		withNth: "2..",
	});
	if (!picked) {
		throw new Error("Song selection cancelled.");
	}
	return picked.split("\t")[0];
}
