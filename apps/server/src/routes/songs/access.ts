import type { Context, Next } from "hono";
import { getRequestActor, type RequestActor } from "../../auth/actor";
import { getDeviceActor } from "../../auth/device";
import * as playlistService from "../../services/playlist-service";
import * as songService from "../../services/song-service";

export async function songReadAccess(c: Context) {
	const actor = await getRequestActor(c);
	return { ownerUserId: actor.kind === "user" ? actor.userId : null };
}

export async function canActorAccessPlaylist(
	actor: RequestActor,
	playlistId: string,
): Promise<boolean> {
	const playlist = await playlistService.getById(playlistId);
	if (!playlist) return false;
	if (!playlist.ownerUserId) return true;
	return actor.kind === "user" && actor.userId === playlist.ownerUserId;
}

export async function canAccessPlaylist(
	c: Context,
	playlistId: string,
): Promise<boolean> {
	return canActorAccessPlaylist(await getRequestActor(c), playlistId);
}

export async function canPlaybackAccessPlaylist(
	c: Context,
	playlistId: string,
): Promise<boolean> {
	const [actor, device, playlist] = await Promise.all([
		getRequestActor(c),
		getDeviceActor(c),
		playlistService.getById(playlistId),
	]);
	if (!playlist) return false;
	if (!playlist.ownerUserId) return true;
	if (actor.kind === "user" && actor.userId === playlist.ownerUserId)
		return true;
	return Boolean(
		playlist.ownerUserId && playlist.ownerUserId === device?.ownerUserId,
	);
}

export async function requirePlaylistAccess(c: Context, next: Next) {
	if (!(await canAccessPlaylist(c, c.req.param("playlistId")))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	await next();
}

export async function requirePlaybackPlaylistAccess(c: Context, next: Next) {
	if (!(await canPlaybackAccessPlaylist(c, c.req.param("playlistId")))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	await next();
}

export async function requireSongAccess(c: Context, next: Next) {
	const song = await songService.getById(c.req.param("id"));
	if (!song || !(await canAccessPlaylist(c, song.playlistId))) {
		return c.json({ error: "Song not found" }, 404);
	}
	await next();
}

export async function requirePlaybackSongAccess(c: Context, next: Next) {
	const song = await songService.getById(c.req.param("id"));
	if (!song || !(await canPlaybackAccessPlaylist(c, song.playlistId))) {
		return c.json({ error: "Song not found" }, 404);
	}
	await next();
}
