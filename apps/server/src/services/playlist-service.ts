import type { PlaylistStatus } from "@infinitune/shared/types";
import { validatePlaylistTransition } from "@infinitune/shared/validation/song-status";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import type { Playlist } from "../db/schema";
import { playlists } from "../db/schema";
import { emit } from "../events/event-bus";
import { parseJsonField, playlistToWire } from "../wire";

// ─── Queries ─────────────────────────────────────────────────────────

export async function getById(id: string): Promise<Playlist | null> {
	const [row] = await db.select().from(playlists).where(eq(playlists.id, id));
	return row ?? null;
}

export async function listAll() {
	const rows = await db.select().from(playlists);
	return rows.map(playlistToWire);
}

export async function getCurrent() {
	const [row] = await db
		.select()
		.from(playlists)
		.where(
			and(
				or(eq(playlists.status, "active"), eq(playlists.status, "closing")),
				ne(playlists.mode, "oneshot"),
			),
		)
		.orderBy(desc(playlists.createdAt))
		.limit(1);
	return row ? playlistToWire(row) : null;
}

export async function listClosed() {
	const rows = await db
		.select()
		.from(playlists)
		.where(
			and(
				or(eq(playlists.status, "closed"), eq(playlists.status, "closing")),
				ne(playlists.mode, "oneshot"),
			),
		)
		.orderBy(desc(playlists.createdAt));
	return rows.map(playlistToWire);
}

export async function listActive() {
	const rows = await db
		.select()
		.from(playlists)
		.where(or(eq(playlists.status, "active"), eq(playlists.status, "closing")));
	return rows.map(playlistToWire);
}

export async function getByKey(key: string) {
	const [row] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.playlistKey, key));
	return row ? playlistToWire(row) : null;
}

// ─── Mutations ───────────────────────────────────────────────────────

export async function create(data: {
	name: string;
	prompt: string;
	llmProvider: string;
	llmModel: string;
	mode?: string;
	playlistKey?: string;
	lyricsLanguage?: string;
	targetBpm?: number;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
	inferenceSteps?: number;
	lmTemperature?: number;
	lmCfgScale?: number;
	inferMethod?: string;
}) {
	const [row] = await db
		.insert(playlists)
		.values({
			name: data.name,
			prompt: data.prompt,
			llmProvider: data.llmProvider,
			llmModel: data.llmModel,
			mode: data.mode ?? "endless",
			status: "active",
			songsGenerated: 0,
			promptEpoch: 0,
			playlistKey: data.playlistKey,
			lyricsLanguage: data.lyricsLanguage,
			targetBpm: data.targetBpm,
			targetKey: data.targetKey,
			timeSignature: data.timeSignature,
			audioDuration: data.audioDuration,
			inferenceSteps: data.inferenceSteps,
			lmTemperature: data.lmTemperature,
			lmCfgScale: data.lmCfgScale,
			inferMethod: data.inferMethod,
		})
		.returning();

	emit("playlist.created", { playlistId: row.id });

	return playlistToWire(row);
}

export async function updateParams(
	id: string,
	params: Record<string, unknown>,
) {
	const allowedKeys = [
		"lyricsLanguage",
		"targetBpm",
		"targetKey",
		"timeSignature",
		"audioDuration",
		"inferenceSteps",
		"lmTemperature",
		"lmCfgScale",
		"inferMethod",
	];

	const patch: Record<string, unknown> = {};
	for (const key of allowedKeys) {
		if (params[key] !== undefined) patch[key] = params[key];
	}

	if (Object.keys(patch).length > 0) {
		await db.update(playlists).set(patch).where(eq(playlists.id, id));
	}

	emit("playlist.updated", { playlistId: id });
}

export async function updateStatus(id: string, status: PlaylistStatus) {
	const [current] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.id, id));
	if (!current) return;

	const from = current.status as PlaylistStatus;
	if (!validatePlaylistTransition(from, status)) {
		throw new Error(`Invalid playlist transition: ${from} → ${status}`);
	}

	await db.update(playlists).set({ status }).where(eq(playlists.id, id));

	emit("playlist.status_changed", { playlistId: id, from, to: status });
}

export async function updatePosition(id: string, currentOrderIndex: number) {
	await db
		.update(playlists)
		.set({ currentOrderIndex })
		.where(eq(playlists.id, id));

	emit("playlist.updated", { playlistId: id });
}

export async function incrementGenerated(id: string) {
	await db
		.update(playlists)
		.set({ songsGenerated: sql`${playlists.songsGenerated} + 1` })
		.where(eq(playlists.id, id));

	emit("playlist.updated", { playlistId: id });
}

export async function resetDefaults(id: string) {
	await db
		.update(playlists)
		.set({
			lyricsLanguage: null,
			targetBpm: null,
			targetKey: null,
			timeSignature: null,
			audioDuration: null,
			inferenceSteps: null,
			lmTemperature: null,
			lmCfgScale: null,
			inferMethod: null,
		})
		.where(eq(playlists.id, id));

	emit("playlist.updated", { playlistId: id });
}

export async function steer(id: string, prompt: string) {
	const [row] = await db.select().from(playlists).where(eq(playlists.id, id));
	if (!row) return;

	const newEpoch = (row.promptEpoch ?? 0) + 1;
	const history: Array<{ epoch: number; direction: string; at: number }> =
		parseJsonField<Array<{ epoch: number; direction: string; at: number }>>(
			row.steerHistory,
		) ?? [];
	history.push({ epoch: newEpoch, direction: prompt, at: Date.now() });

	await db
		.update(playlists)
		.set({
			prompt,
			promptEpoch: newEpoch,
			steerHistory: JSON.stringify(history),
		})
		.where(eq(playlists.id, id));

	emit("playlist.steered", { playlistId: id, newEpoch });
}

export async function toggleStar(id: string) {
	const [updated] = await db
		.update(playlists)
		.set({ isStarred: sql`NOT is_starred` })
		.where(eq(playlists.id, id))
		.returning({ isStarred: playlists.isStarred });

	if (!updated) return undefined;

	emit("playlist.updated", { playlistId: id });
	return { isStarred: updated.isStarred };
}

export async function deletePlaylist(id: string) {
	await db.delete(playlists).where(eq(playlists.id, id));
	emit("playlist.deleted", { playlistId: id });
}

export async function heartbeat(id: string) {
	const [row] = await db.select().from(playlists).where(eq(playlists.id, id));
	if (!row) return;

	const patch: Record<string, unknown> = { lastSeenAt: Date.now() };
	const shouldReactivate = row.status === "closing";
	if (shouldReactivate) {
		patch.status = "active";
	}

	await db.update(playlists).set(patch).where(eq(playlists.id, id));

	emit("playlist.heartbeat", { playlistId: id });

	if (shouldReactivate) {
		emit("playlist.status_changed", {
			playlistId: id,
			from: "closing",
			to: "active",
		});
	}
}
