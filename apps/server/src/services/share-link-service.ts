import { randomBytes } from "node:crypto";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
} from "drizzle-orm";
import { db } from "../db/index";
import { playlists, shareLinks, songs } from "../db/schema";
import * as playlistService from "./playlist-service";
import * as songService from "./song-service";

export const SHARE_RESOURCE_TYPES = ["playlist", "song"] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];
export const MAX_LIVE_SHARE_LINKS_PER_RESOURCE = 20;
export const MAX_PUBLIC_SHARE_SONGS = 100;
export const ANONYMOUS_SHARE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ShareLink {
	id: string;
	createdAt: number;
	token: string;
	resourceType: ShareResourceType;
	resourceId: string;
	expiresAt: number | null;
	revokedAt: number | null;
}

export interface ShareResource {
	resourceType: ShareResourceType;
	resourceId: string;
	ownerUserId: string | null;
	playlistId: string;
	isTemporary: boolean;
}

export class ShareLinkLimitError extends Error {
	constructor() {
		super("This resource already has the maximum number of live share links");
		this.name = "ShareLinkLimitError";
	}
}

function toShareLink(row: typeof shareLinks.$inferSelect): ShareLink {
	return {
		id: row.id,
		createdAt: row.createdAt,
		token: row.token,
		resourceType: row.resourceType as ShareResourceType,
		resourceId: row.resourceId,
		expiresAt: row.expiresAt,
		revokedAt: row.revokedAt,
	};
}

export function isShareResourceType(value: string): value is ShareResourceType {
	return (SHARE_RESOURCE_TYPES as readonly string[]).includes(value);
}

export async function getShareResource(
	resourceType: ShareResourceType,
	resourceId: string,
): Promise<ShareResource | null> {
	if (resourceType === "playlist") {
		const playlist = await playlistService.getById(resourceId);
		return playlist
			? {
					resourceType,
					resourceId,
					ownerUserId: playlist.ownerUserId,
					playlistId: playlist.id,
					isTemporary: playlist.isTemporary,
				}
			: null;
	}

	const song = await songService.getById(resourceId);
	if (!song) return null;
	const playlist = await playlistService.getById(song.playlistId);
	return playlist
		? {
				resourceType,
				resourceId,
				ownerUserId: playlist.ownerUserId,
				playlistId: playlist.id,
				isTemporary: playlist.isTemporary,
			}
		: null;
}

interface CreateShareLinkInput {
	resourceType: ShareResourceType;
	resourceId: string;
	expiresInDays?: number;
}

type ShareCreationPolicy =
	| { kind: "trusted" }
	| { kind: "request"; actorUserId: string | null };

async function createShareLinkWithPolicy(
	input: CreateShareLinkInput,
	policy: ShareCreationPolicy,
): Promise<ShareLink | null> {
	const now = Date.now();
	let expiresAt =
		input.expiresInDays && input.expiresInDays > 0
			? now + input.expiresInDays * 24 * 60 * 60 * 1000
			: null;
	return db.transaction((tx) => {
		const resource =
			input.resourceType === "playlist"
				? tx
						.select({
							playlistId: playlists.id,
							ownerUserId: playlists.ownerUserId,
							isTemporary: playlists.isTemporary,
							expiresAt: playlists.expiresAt,
						})
						.from(playlists)
						.where(eq(playlists.id, input.resourceId))
						.get()
				: tx
						.select({
							playlistId: playlists.id,
							ownerUserId: playlists.ownerUserId,
							isTemporary: playlists.isTemporary,
							expiresAt: playlists.expiresAt,
						})
						.from(songs)
						.innerJoin(playlists, eq(songs.playlistId, playlists.id))
						.where(eq(songs.id, input.resourceId))
						.get();
		if (!resource) return null;

		let preserveResourceRetention = true;
		let reuseAnonymousTimedLink = false;
		if (policy.kind === "request") {
			if (resource.ownerUserId) {
				if (resource.ownerUserId !== policy.actorUserId) return null;
			} else {
				const anonymousExpiry = now + ANONYMOUS_SHARE_TTL_MS;
				expiresAt =
					resource.expiresAt !== null
						? Math.min(anonymousExpiry, resource.expiresAt)
						: anonymousExpiry;
				if (expiresAt <= now) return null;
				preserveResourceRetention = false;
				reuseAnonymousTimedLink = true;
			}
		}

		tx.delete(shareLinks)
			.where(
				or(
					isNotNull(shareLinks.revokedAt),
					and(isNotNull(shareLinks.expiresAt), lte(shareLinks.expiresAt, now)),
				),
			)
			.run();
		const liveLinks = tx
			.select()
			.from(shareLinks)
			.where(
				and(
					eq(shareLinks.resourceType, input.resourceType),
					eq(shareLinks.resourceId, input.resourceId),
					isNull(shareLinks.revokedAt),
					or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
				),
			)
			.orderBy(desc(shareLinks.createdAt))
			.all()
			.map(toShareLink);

		if (reuseAnonymousTimedLink) {
			const reusable = liveLinks.find(
				(link) => link.expiresAt !== null && link.expiresAt <= (expiresAt ?? 0),
			);
			if (reusable) return reusable;
		}

		const preserveTemporaryResource = (linkExpiry: number | null) => {
			if (!preserveResourceRetention || !resource.isTemporary) return;
			if (linkExpiry === null) {
				tx.update(playlists)
					.set({ isTemporary: false, expiresAt: null })
					.where(eq(playlists.id, resource.playlistId))
					.run();
			} else {
				tx.update(playlists)
					.set({ expiresAt: linkExpiry })
					.where(
						and(
							eq(playlists.id, resource.playlistId),
							eq(playlists.isTemporary, true),
							isNotNull(playlists.expiresAt),
							lt(playlists.expiresAt, linkExpiry),
						),
					)
					.run();
			}
		};

		if (expiresAt === null) {
			const reusable = liveLinks.find((link) => link.expiresAt === null);
			if (reusable) {
				preserveTemporaryResource(reusable.expiresAt);
				return reusable;
			}
		}

		if (liveLinks.length >= MAX_LIVE_SHARE_LINKS_PER_RESOURCE) {
			throw new ShareLinkLimitError();
		}

		const row = tx
			.insert(shareLinks)
			.values({
				token: randomBytes(24).toString("base64url"),
				resourceType: input.resourceType,
				resourceId: input.resourceId,
				expiresAt,
			})
			.returning()
			.get();
		preserveTemporaryResource(expiresAt);
		return toShareLink(row);
	});
}

export async function createShareLink(
	input: CreateShareLinkInput,
): Promise<ShareLink | null> {
	return createShareLinkWithPolicy(input, { kind: "trusted" });
}

export async function createShareLinkForRequest(
	input: CreateShareLinkInput,
	actorUserId: string | null,
): Promise<ShareLink | null> {
	return createShareLinkWithPolicy(input, { kind: "request", actorUserId });
}

export async function listShareLinksForResource(
	resourceType: ShareResourceType,
	resourceId: string,
): Promise<ShareLink[]> {
	const rows = await db
		.select()
		.from(shareLinks)
		.where(
			and(
				eq(shareLinks.resourceType, resourceType),
				eq(shareLinks.resourceId, resourceId),
				isNull(shareLinks.revokedAt),
				or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, Date.now())),
			),
		)
		.orderBy(desc(shareLinks.createdAt));
	return rows.map(toShareLink);
}

export async function getShareLinkById(id: string): Promise<ShareLink | null> {
	const [row] = await db
		.select()
		.from(shareLinks)
		.where(eq(shareLinks.id, id))
		.limit(1);
	return row ? toShareLink(row) : null;
}

async function findLiveByToken(token: string): Promise<ShareLink | null> {
	const [row] = await db
		.select()
		.from(shareLinks)
		.where(
			and(
				eq(shareLinks.token, token),
				isNull(shareLinks.revokedAt),
				or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, Date.now())),
			),
		)
		.limit(1);
	return row ? toShareLink(row) : null;
}

export async function revokeShareLink(id: string): Promise<boolean> {
	const updated = await db
		.update(shareLinks)
		.set({ revokedAt: Date.now() })
		.where(and(eq(shareLinks.id, id), isNull(shareLinks.revokedAt)))
		.returning({ id: shareLinks.id });
	return updated.length > 0;
}

// ─── Public snapshots ────────────────────────────────────────────────

interface PublicSong {
	id: string;
	title: string | null;
	artistName: string | null;
	genre: string | null;
	audioDuration: number | null;
	audioUrl: string | null;
	coverUrl: string | null;
}

interface SongRowLike {
	id: string;
	title: string | null;
	artistName: string | null;
	genre: string | null;
	audioDuration: number | null;
	audioUrl: string | null;
	coverUrl: string | null;
}

function toPublicSongFromRow(song: SongRowLike): PublicSong {
	return {
		id: song.id,
		title: song.title,
		artistName: song.artistName,
		genre: song.genre,
		audioDuration: song.audioDuration,
		audioUrl: song.audioUrl,
		coverUrl: song.coverUrl,
	};
}

/**
 * Resolve a share token into a read-only public snapshot. Only playable songs
 * with audio are included; generation internals stay private.
 */
export async function resolveShareLink(token: string): Promise<{
	resourceType: ShareResourceType;
	payload: Record<string, unknown>;
} | null> {
	const link = await findLiveByToken(token);
	if (!link) return null;

	if (link.resourceType === "playlist") {
		const playlist = await playlistService.getById(link.resourceId);
		if (!playlist) return null;
		const publicSongs = await db
			.select({
				id: songs.id,
				title: songs.title,
				artistName: songs.artistName,
				genre: songs.genre,
				audioDuration: songs.audioDuration,
				audioUrl: songs.audioUrl,
				coverUrl: songs.coverUrl,
			})
			.from(songs)
			.where(
				and(
					eq(songs.playlistId, playlist.id),
					inArray(songs.status, ["ready", "played"]),
					isNotNull(songs.audioUrl),
				),
			)
			.orderBy(asc(songs.orderIndex))
			.limit(MAX_PUBLIC_SHARE_SONGS);
		return {
			resourceType: "playlist",
			payload: {
				name: playlist.name,
				description: playlist.description,
				status: playlist.status,
				songs: publicSongs.map(toPublicSongFromRow),
			},
		};
	}

	const song = await songService.getById(link.resourceId);
	if (
		!song ||
		(song.status !== "ready" && song.status !== "played") ||
		!song.audioUrl
	)
		return null;
	return {
		resourceType: "song",
		payload: { song: toPublicSongFromRow(song) },
	};
}
