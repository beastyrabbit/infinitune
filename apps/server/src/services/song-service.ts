import { ACTIVE_STATUSES, type SongStatus } from "@infinitune/shared/types";
import { validateSongTransition } from "@infinitune/shared/validation/song-status";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db/index";
import type { Song } from "../db/schema";
import { playlists, songs } from "../db/schema";
import { emit } from "../events/event-bus";
import { songLogger } from "../logger";
import { parseJsonField, songToWire } from "../wire";

// ─── Metadata field definitions ──────────────────────────────────────

const METADATA_SCALAR_FIELDS = [
	"title",
	"artistName",
	"genre",
	"subGenre",
	"lyrics",
	"caption",
	"coverPrompt",
	"bpm",
	"keyScale",
	"timeSignature",
	"audioDuration",
	"vocalStyle",
	"mood",
	"energy",
	"era",
	"language",
	"description",
] as const;

const METADATA_JSON_FIELDS = ["instruments", "tags", "themes"] as const;

function buildMetadataPatch(
	body: Record<string, unknown>,
	extraScalarFields: readonly string[] = [],
): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const key of [...METADATA_SCALAR_FIELDS, ...extraScalarFields]) {
		if (body[key] !== undefined) patch[key] = body[key];
	}
	for (const key of METADATA_JSON_FIELDS) {
		if (body[key] !== undefined)
			patch[key] = body[key] ? JSON.stringify(body[key]) : null;
	}
	return patch;
}

// ─── Queries ─────────────────────────────────────────────────────────

export async function getById(id: string): Promise<Song | null> {
	const [row] = await db.select().from(songs).where(eq(songs.id, id));
	return row ?? null;
}

export async function listByPlaylist(playlistId: string) {
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId));
	return rows.sort((a, b) => a.orderIndex - b.orderIndex).map(songToWire);
}

export async function listAll(limit = 200) {
	const rows = await db
		.select()
		.from(songs)
		.where(isNotNull(songs.title))
		.orderBy(desc(songs.createdAt))
		.limit(limit);
	return rows.map(songToWire);
}

export async function getNextOrderIndex(playlistId: string): Promise<number> {
	const rows = await db
		.select({ orderIndex: songs.orderIndex })
		.from(songs)
		.where(eq(songs.playlistId, playlistId));
	if (rows.length === 0) return 1;
	return Math.ceil(Math.max(...rows.map((s) => s.orderIndex))) + 1;
}

export async function getByIds(ids: string[]) {
	if (!ids.length) return [];
	const rows = await db.select().from(songs).where(inArray(songs.id, ids));
	return rows.filter(Boolean).map(songToWire);
}

export async function getInAudioPipeline() {
	const rows = await db
		.select()
		.from(songs)
		.where(
			inArray(songs.status, [
				"submitting_to_ace",
				"generating_audio",
				"saving",
			]),
		);
	return rows.map(songToWire);
}

export async function getNeedsPersona() {
	const rows = await db.select().from(songs).where(isNotNull(songs.userRating));
	return rows
		.filter((s) => !s.personaExtract && s.title)
		.slice(0, 20)
		.map((s) => ({
			id: s.id,
			title: s.title!,
			artistName: s.artistName,
			genre: s.genre,
			subGenre: s.subGenre,
			mood: s.mood,
			energy: s.energy,
			era: s.era,
			vocalStyle: s.vocalStyle,
			instruments: parseJsonField<string[]>(s.instruments),
			themes: parseJsonField<string[]>(s.themes),
			description: s.description,
			lyrics: s.lyrics,
		}));
}

// ─── Mutations ───────────────────────────────────────────────────────

export async function createPending(
	playlistId: string,
	orderIndex: number,
	opts?: {
		isInterrupt?: boolean;
		interruptPrompt?: string;
		promptEpoch?: number;
	},
) {
	const [row] = await db
		.insert(songs)
		.values({
			playlistId,
			orderIndex,
			status: "pending",
			isInterrupt: opts?.isInterrupt,
			interruptPrompt: opts?.interruptPrompt,
			promptEpoch: opts?.promptEpoch,
			generationStartedAt: Date.now(),
		})
		.returning();

	emit("song.created", {
		songId: row.id,
		playlistId,
		status: "pending",
	});

	return songToWire(row);
}

export async function createWithMetadata(
	playlistId: string,
	orderIndex: number,
	metadata: Record<string, unknown>,
) {
	const patch = buildMetadataPatch(metadata);

	const [row] = await db
		.insert(songs)
		.values({
			playlistId,
			orderIndex,
			status: "metadata_ready",
			promptEpoch: metadata.promptEpoch as number | undefined,
			generationStartedAt: Date.now(),
			...patch,
		} as typeof songs.$inferInsert)
		.returning();

	emit("song.created", {
		songId: row.id,
		playlistId,
		status: "metadata_ready",
	});

	return songToWire(row);
}

/**
 * Atomically claim a pending song for metadata generation.
 * Returns true if claimed, false if already claimed or not pending.
 */
export function claimMetadata(id: string): boolean {
	const result = sqlite.transaction(() => {
		const row = sqlite
			.prepare("SELECT status, playlist_id FROM songs WHERE id = ?")
			.get(id) as { status: string; playlist_id: string } | undefined;
		if (!row || row.status !== "pending") return null;
		sqlite
			.prepare("UPDATE songs SET status = 'generating_metadata' WHERE id = ?")
			.run(id);
		return row.playlist_id;
	})();

	if (result) {
		emit("song.status_changed", {
			songId: id,
			playlistId: result,
			from: "pending",
			to: "generating_metadata",
		});
	}

	return result !== null;
}

/**
 * Atomically claim a metadata_ready song for audio generation.
 * Returns true if claimed, false if already claimed or not ready.
 */
export function claimAudio(id: string): boolean {
	const result = sqlite.transaction(() => {
		const row = sqlite
			.prepare("SELECT status, playlist_id FROM songs WHERE id = ?")
			.get(id) as { status: string; playlist_id: string } | undefined;
		if (!row || row.status !== "metadata_ready") return null;
		sqlite
			.prepare("UPDATE songs SET status = 'submitting_to_ace' WHERE id = ?")
			.run(id);
		return row.playlist_id;
	})();

	if (result) {
		emit("song.status_changed", {
			songId: id,
			playlistId: result,
			from: "metadata_ready",
			to: "submitting_to_ace",
		});
	}

	return result !== null;
}

export async function completeMetadata(
	id: string,
	metadata: Record<string, unknown>,
) {
	const [current] = await db.select().from(songs).where(eq(songs.id, id));
	if (!current) return;

	const patch = buildMetadataPatch(metadata, [
		"llmProvider",
		"llmModel",
		"metadataProcessingMs",
	]);
	patch.status = "metadata_ready";

	await db.update(songs).set(patch).where(eq(songs.id, id));

	emit("song.status_changed", {
		songId: id,
		playlistId: current.playlistId,
		from: current.status,
		to: "metadata_ready",
	});
}

export async function updateStatus(
	id: string,
	status: SongStatus,
	opts?: { errorMessage?: string },
) {
	const [current] = await db.select().from(songs).where(eq(songs.id, id));
	if (!current) return;

	const from = current.status as SongStatus;
	if (!validateSongTransition(from, status)) {
		throw new Error(`Invalid song transition: ${from} → ${status}`);
	}

	const patch: Record<string, unknown> = { status };
	if (opts?.errorMessage) patch.errorMessage = opts.errorMessage;

	await db.update(songs).set(patch).where(eq(songs.id, id));

	emit("song.status_changed", {
		songId: id,
		playlistId: current.playlistId,
		from,
		to: status,
	});
}

export async function updateAceTask(id: string, aceTaskId: string) {
	const [current] = await db.select().from(songs).where(eq(songs.id, id));
	if (!current) return;

	await db
		.update(songs)
		.set({
			aceTaskId,
			aceSubmittedAt: Date.now(),
			status: "generating_audio",
		})
		.where(eq(songs.id, id));

	emit("song.status_changed", {
		songId: id,
		playlistId: current.playlistId,
		from: current.status,
		to: "generating_audio",
	});
}

export async function markReady(
	id: string,
	audioUrl: string,
	audioProcessingMs?: number,
) {
	const [current] = await db.select().from(songs).where(eq(songs.id, id));
	if (!current) return;

	const patch: Record<string, unknown> = {
		audioUrl,
		status: "ready",
		generationCompletedAt: Date.now(),
	};
	if (audioProcessingMs !== undefined)
		patch.audioProcessingMs = audioProcessingMs;

	await db.update(songs).set(patch).where(eq(songs.id, id));

	emit("song.status_changed", {
		songId: id,
		playlistId: current.playlistId,
		from: current.status,
		to: "ready",
	});
}

export async function markError(
	id: string,
	errorMessage: string,
	erroredAtStatus?: string,
) {
	const [song] = await db.select().from(songs).where(eq(songs.id, id));
	if (!song) return;

	const retryCount = song.retryCount || 0;
	const canRetry = retryCount < 3;
	const newStatus = canRetry ? "retry_pending" : "error";
	const fromStatus = song.status;
	const effectiveErroredAtStatus = erroredAtStatus || fromStatus;

	await db
		.update(songs)
		.set({
			status: newStatus,
			errorMessage,
			erroredAtStatus: effectiveErroredAtStatus,
		})
		.where(eq(songs.id, id));
	songLogger(id, song.playlistId).warn(
		{
			fromStatus,
			toStatus: newStatus,
			retryCount,
			nextRetryCount: canRetry ? retryCount + 1 : retryCount,
			erroredAtStatus: effectiveErroredAtStatus,
			errorMessage,
		},
		"Song marked as errored",
	);

	emit("song.status_changed", {
		songId: id,
		playlistId: song.playlistId,
		from: fromStatus,
		to: newStatus,
	});
}

export async function retryErrored(id: string) {
	const [song] = await db.select().from(songs).where(eq(songs.id, id));
	if (!song || song.status !== "retry_pending") return;

	const revertTo =
		song.erroredAtStatus === "generating_metadata"
			? "pending"
			: "metadata_ready";

	await db
		.update(songs)
		.set({
			status: revertTo,
			retryCount: (song.retryCount || 0) + 1,
			errorMessage: null,
			erroredAtStatus: null,
			generationStartedAt: Date.now(),
		})
		.where(eq(songs.id, id));
	songLogger(id, song.playlistId).info(
		{
			fromStatus: "retry_pending",
			toStatus: revertTo,
			retryCount: song.retryCount || 0,
			nextRetryCount: (song.retryCount || 0) + 1,
			previousErroredAtStatus: song.erroredAtStatus,
		},
		"Song retry scheduled",
	);

	emit("song.status_changed", {
		songId: id,
		playlistId: song.playlistId,
		from: "retry_pending",
		to: revertTo,
	});
}

export async function revertTransient(id: string) {
	const [song] = await db.select().from(songs).where(eq(songs.id, id));
	if (!song) return;

	let newStatus: string | null = null;

	if (song.status === "generating_metadata") {
		newStatus = "pending";
		await db
			.update(songs)
			.set({ status: "pending", generationStartedAt: Date.now() })
			.where(eq(songs.id, id));
	} else if (
		["submitting_to_ace", "generating_audio", "saving"].includes(song.status)
	) {
		newStatus = "metadata_ready";
		await db
			.update(songs)
			.set({
				status: "metadata_ready",
				aceTaskId: null,
				aceSubmittedAt: null,
				generationStartedAt: Date.now(),
			})
			.where(eq(songs.id, id));
	}

	if (newStatus) {
		emit("song.status_changed", {
			songId: id,
			playlistId: song.playlistId,
			from: song.status,
			to: newStatus,
		});
	}
}

export async function revertAllTransient(playlistId: string) {
	await db
		.update(songs)
		.set({ status: "pending" })
		.where(
			and(
				eq(songs.playlistId, playlistId),
				eq(songs.status, "generating_metadata"),
			),
		);

	await db
		.update(songs)
		.set({ status: "metadata_ready" })
		.where(
			and(
				eq(songs.playlistId, playlistId),
				inArray(songs.status, [
					"submitting_to_ace",
					"generating_audio",
					"saving",
				]),
			),
		);

	emit("song.metadata_updated", { songId: "", playlistId });
}

export async function recoverPlaylist(playlistId: string): Promise<number> {
	const recoveryMap: [string, string][] = [
		["generating_metadata", "pending"],
		["submitting_to_ace", "metadata_ready"],
		["saving", "generating_audio"],
	];

	let recovered = 0;
	for (const [fromStatus, toStatus] of recoveryMap) {
		const result = await db
			.update(songs)
			.set({ status: toStatus })
			.where(
				and(eq(songs.playlistId, playlistId), eq(songs.status, fromStatus)),
			)
			.returning({ id: songs.id });
		recovered += result.length;
	}

	if (recovered > 0) {
		emit("song.metadata_updated", { songId: "", playlistId });
	}

	return recovered;
}

export async function deleteSong(id: string) {
	const [song] = await db.select().from(songs).where(eq(songs.id, id));
	const playlistId = song?.playlistId;

	await db.delete(songs).where(eq(songs.id, id));

	if (playlistId) {
		emit("song.deleted", { songId: id, playlistId });
	}
}

export async function rateSong(id: string, rating: "up" | "down") {
	const [song] = await db.select().from(songs).where(eq(songs.id, id));
	if (!song) return;

	const newRating = song.userRating === rating ? null : rating;
	await db.update(songs).set({ userRating: newRating }).where(eq(songs.id, id));

	emit("song.metadata_updated", { songId: id, playlistId: song.playlistId });
}

export async function updateMetadata(
	id: string,
	metadata: Record<string, unknown>,
) {
	const patch = buildMetadataPatch(metadata);
	await db.update(songs).set(patch).where(eq(songs.id, id));
	const [row] = await db.select().from(songs).where(eq(songs.id, id));

	if (row) {
		emit("song.metadata_updated", {
			songId: id,
			playlistId: row.playlistId,
		});
	}
}

export async function updateCover(id: string, coverUrl: string) {
	await db.update(songs).set({ coverUrl }).where(eq(songs.id, id));
	const [row] = await db.select().from(songs).where(eq(songs.id, id));

	if (row) {
		emit("song.metadata_updated", {
			songId: id,
			playlistId: row.playlistId,
		});
	}
}

export async function updateStoragePath(
	id: string,
	storagePath: string,
	aceAudioPath?: string,
) {
	const patch: Record<string, unknown> = { storagePath };
	if (aceAudioPath) patch.aceAudioPath = aceAudioPath;
	await db.update(songs).set(patch).where(eq(songs.id, id));
}

export async function updateAudioDuration(id: string, audioDuration: number) {
	await db.update(songs).set({ audioDuration }).where(eq(songs.id, id));
}

export async function updateCoverProcessingMs(
	id: string,
	coverProcessingMs: number,
) {
	await db.update(songs).set({ coverProcessingMs }).where(eq(songs.id, id));
}

export async function updatePersonaExtract(id: string, personaExtract: string) {
	await db.update(songs).set({ personaExtract }).where(eq(songs.id, id));
}

export async function incrementListenCount(id: string) {
	await db
		.update(songs)
		.set({ listenCount: sql`coalesce(${songs.listenCount}, 0) + 1` })
		.where(eq(songs.id, id));
}

export async function addPlayDuration(id: string, durationMs: number) {
	await db
		.update(songs)
		.set({
			playDurationMs: sql`coalesce(${songs.playDurationMs}, 0) + ${durationMs}`,
		})
		.where(eq(songs.id, id));
}

export async function reorderSong(id: string, newOrderIndex: number) {
	await db
		.update(songs)
		.set({ orderIndex: newOrderIndex })
		.where(eq(songs.id, id));
	const [row] = await db.select().from(songs).where(eq(songs.id, id));

	if (row) {
		emit("song.reordered", { songId: id, playlistId: row.playlistId });
	}
}

export async function reindexPlaylist(playlistId: string) {
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId));
	const sorted = [...rows].sort((a, b) => a.orderIndex - b.orderIndex);

	for (let i = 0; i < sorted.length; i++) {
		const cleanIndex = i + 1;
		if (sorted[i].orderIndex !== cleanIndex) {
			await db
				.update(songs)
				.set({ orderIndex: cleanIndex })
				.where(eq(songs.id, sorted[i].id));
		}
	}

	emit("song.reordered", { songId: "", playlistId });
}

export async function getWorkQueue(playlistId: string) {
	const IN_FLIGHT_STATUSES: SongStatus[] = [
		"generating_metadata",
		"submitting_to_ace",
		"generating_audio",
		"saving",
	];

	const allSongs = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId));

	const [playlist] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.id, playlistId));

	const pending = allSongs
		.filter((s) => s.status === "pending")
		.sort((a, b) => a.orderIndex - b.orderIndex);
	const metadataReady = allSongs
		.filter((s) => s.status === "metadata_ready")
		.sort((a, b) => a.orderIndex - b.orderIndex);
	const needsCover = allSongs.filter(
		(s) =>
			s.coverPrompt &&
			!s.coverUrl &&
			s.status !== "pending" &&
			s.status !== "generating_metadata" &&
			s.status !== "error",
	);
	const generatingAudio = allSongs.filter(
		(s) => s.status === "generating_audio",
	);
	const retryPending = allSongs.filter((s) => s.status === "retry_pending");
	const needsRecovery = allSongs.filter(
		(s) =>
			s.status === "generating_metadata" ||
			s.status === "submitting_to_ace" ||
			s.status === "saving",
	);

	const currentOrderIndex = playlist?.currentOrderIndex ?? 0;
	const currentEpoch = playlist?.promptEpoch ?? 0;
	const songsAhead = allSongs.filter(
		(s) =>
			s.orderIndex > currentOrderIndex &&
			ACTIVE_STATUSES.includes(s.status as SongStatus) &&
			(s.promptEpoch ?? 0) === currentEpoch,
	).length;
	const bufferDeficit = Math.max(0, 5 - songsAhead);

	const maxOrderIndex =
		allSongs.length > 0 ? Math.max(...allSongs.map((s) => s.orderIndex)) : 0;
	const transientCount = allSongs.filter((s) =>
		IN_FLIGHT_STATUSES.includes(s.status as SongStatus),
	).length;

	const completedSongs = allSongs
		.filter(
			(s) =>
				s.title && s.status !== "pending" && s.status !== "generating_metadata",
		)
		.sort((a, b) => b.orderIndex - a.orderIndex);

	const recentCompleted = completedSongs.slice(0, 5).map((s) => ({
		title: s.title!,
		artistName: s.artistName!,
		genre: s.genre!,
		subGenre: s.subGenre!,
		vocalStyle: s.vocalStyle,
		mood: s.mood,
		energy: s.energy,
	}));

	const recentDescriptions = completedSongs
		.slice(0, 20)
		.map((s) => s.description)
		.filter((d): d is string => !!d);

	const STALE_TIMEOUT_MS = 20 * 60 * 1000;
	const now = Date.now();
	const staleSongs = allSongs
		.filter((s) => {
			if (!IN_FLIGHT_STATUSES.includes(s.status as SongStatus)) return false;
			if (s.status === "generating_audio") {
				const audioStart =
					s.aceSubmittedAt || s.generationStartedAt || s.createdAt;
				return now - audioStart > STALE_TIMEOUT_MS;
			}
			const startedAt = s.generationStartedAt || s.createdAt;
			return now - startedAt > STALE_TIMEOUT_MS;
		})
		.map((s) => ({ id: s.id, status: s.status, title: s.title }));

	return {
		pending: pending.map(songToWire),
		metadataReady: metadataReady.map(songToWire),
		needsCover: needsCover.map(songToWire),
		generatingAudio: generatingAudio.map(songToWire),
		retryPending: retryPending.map(songToWire),
		needsRecovery: needsRecovery.map(songToWire),
		bufferDeficit,
		maxOrderIndex,
		totalSongs: allSongs.length,
		transientCount,
		currentEpoch,
		recentCompleted,
		recentDescriptions,
		staleSongs,
	};
}
