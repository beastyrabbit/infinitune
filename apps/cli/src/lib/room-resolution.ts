import type { RoomInfo } from "@infinitune/shared/protocol";
import type { Playlist } from "@infinitune/shared/types";
import {
	createRoom,
	getCurrentPlaylist,
	listPlaylists,
	listRooms,
} from "./api";
import { pickFromFzf } from "./fzf";

export type ResolvedRoom = {
	room: RoomInfo;
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

function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24);
}

function createRoomIdFromPlaylist(playlist: Playlist): string {
	const seed = playlist.name?.trim() || playlist.playlistKey || "room";
	const slug = slugify(seed) || "room";
	const suffix = Date.now().toString(36).slice(-4);
	return `${slug}-${suffix}`;
}

async function pickPlaylistInteractive(serverUrl: string): Promise<Playlist> {
	const playlists = await listPlaylists(serverUrl);
	if (playlists.length === 0) {
		throw new Error("No playlists found on server.");
	}

	const sorted = [...playlists].sort((a, b) => b.createdAt - a.createdAt);
	const lines = sorted.map((playlist) => {
		const name = playlist.name.trim() || "(untitled playlist)";
		return `${playlist.id}\t${name}`;
	});

	const picked = pickFromFzf(lines, {
		prompt: "playlist",
		header: "playlist name",
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
	if (!playlist.playlistKey) {
		throw new Error("Selected playlist has no playlistKey.");
	}
	return playlist;
}

async function pickRoomInteractive(rooms: RoomInfo[]): Promise<RoomInfo> {
	const lines = rooms.map((room) => {
		return `${room.id}\t${room.name}\t${room.playlistKey}\t${room.deviceCount}`;
	});
	const picked = pickFromFzf(lines, {
		prompt: "room",
		header: "name | playlistKey | devices",
		delimiter: "\t",
		withNth: "2..",
	});
	if (!picked) {
		throw new Error("Room selection cancelled.");
	}
	const id = picked.split("\t")[0];
	const room = rooms.find((entry) => entry.id === id);
	if (!room) {
		throw new Error("Failed to resolve selected room.");
	}
	return room;
}

async function ensureRoomForPlaylist(
	serverUrl: string,
	playlist: Playlist,
): Promise<ResolvedRoom> {
	const key = playlist.playlistKey;
	if (!key) {
		throw new Error(`Playlist "${playlist.name}" has no playlistKey.`);
	}

	const rooms = await listRooms(serverUrl);
	const matching = rooms.filter((room) => room.playlistKey === key);
	if (matching.length === 1) {
		return { room: matching[0], playlist, created: false };
	}
	if (matching.length > 1) {
		const room = await pickRoomInteractive(matching);
		return { room, playlist, created: false };
	}

	const roomId = createRoomIdFromPlaylist(playlist);
	const roomName = `${playlist.name} Room`;
	await createRoom(serverUrl, {
		id: roomId,
		name: roomName,
		playlistKey: key,
	});

	const refreshedRooms = await listRooms(serverUrl);
	const createdRoom = refreshedRooms.find((room) => room.id === roomId);
	if (!createdRoom) {
		throw new Error("Room was created but could not be fetched from server.");
	}
	return { room: createdRoom, playlist, created: true };
}

async function resolveByRoomId(
	serverUrl: string,
	roomId: string,
): Promise<ResolvedRoom> {
	const rooms = await listRooms(serverUrl);
	const room = rooms.find((entry) => entry.id === roomId);
	if (!room) {
		throw new Error(`Room "${roomId}" not found.`);
	}

	let playlist: Playlist | null = null;
	const playlists = await listPlaylists(serverUrl);
	playlist =
		playlists.find((entry) => entry.playlistKey === room.playlistKey) ?? null;
	return { room, playlist, created: false };
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
	return ensureRoomForPlaylist(serverUrl, playlist);
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
		return ensureRoomForPlaylist(serverUrl, current);
	}

	const playlist = await pickPlaylistInteractive(serverUrl);
	return ensureRoomForPlaylist(serverUrl, playlist);
}

export async function pickExistingRoom(serverUrl: string): Promise<RoomInfo> {
	const rooms = await listRooms(serverUrl);
	if (rooms.length === 0) {
		throw new Error("No rooms available.");
	}
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
