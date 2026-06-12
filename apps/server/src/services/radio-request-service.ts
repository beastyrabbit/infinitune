import { createId } from "@paralleldrive/cuid2";
import { sqlite } from "../db/index";
import { emit } from "../events/event-bus";
import { createRadioAlbum } from "./album-generation-service";
import { recomputeRadioSchedule } from "./radio-mixer-service";

export type RadioRequestKind = "song" | "album" | "auto";

export interface RadioRequestWire {
	id: string;
	createdAt: number;
	prompt: string;
	kind: RadioRequestKind;
	status: string;
	matchedSongId: string | null;
	albumId: string | null;
	targetSongId: string | null;
	scheduleSlot: number | null;
	notificationState: string | null;
}

function classifyPrompt(prompt: string): RadioRequestKind {
	const lower = prompt.toLowerCase();
	if (/\balbum\b|\bep\b|\brecord\b/.test(lower)) return "album";
	if (/\bsong\b|\btrack\b|\bsingle\b|\bplay\b/.test(lower)) return "song";
	return "auto";
}

function mapRequest(row: Record<string, unknown>): RadioRequestWire {
	return {
		id: String(row.id),
		createdAt: Number(row.created_at),
		prompt: String(row.prompt),
		kind: String(row.kind) as RadioRequestKind,
		status: String(row.status),
		matchedSongId: row.matched_song_id as string | null,
		albumId: row.album_id as string | null,
		targetSongId: row.target_song_id as string | null,
		scheduleSlot: row.schedule_slot as number | null,
		notificationState: row.notification_state as string | null,
	};
}

function findReadyRadioMatch(prompt: string): string | null {
	const tokens = prompt
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 4)
		.slice(0, 8);
	if (tokens.length === 0) return null;
	const rows = sqlite
		.prepare(
			`
				SELECT id, title, genre, vocal_style as vocalStyle, description
				FROM songs
				WHERE radio_eligible = 1
					AND album_id IS NOT NULL
					AND status = 'ready'
				ORDER BY radio_play_count ASC, created_at DESC
				LIMIT 80
			`,
		)
		.all() as Array<{
		id: string;
		title: string | null;
		genre: string | null;
		vocalStyle: string | null;
		description: string | null;
	}>;
	let best: { id: string; score: number } | null = null;
	for (const row of rows) {
		const haystack = [row.title, row.genre, row.vocalStyle, row.description]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		const score = tokens.reduce(
			(sum, token) => sum + (haystack.includes(token) ? 1 : 0),
			0,
		);
		if (score > 0 && (!best || score > best.score)) {
			best = { id: row.id, score };
		}
	}
	return best?.id ?? null;
}

export async function submitRadioRequest(prompt: string) {
	const trimmed = prompt.trim();
	if (!trimmed) throw new Error("Request prompt is required");
	const id = createId();
	const now = Date.now();
	const kind = classifyPrompt(trimmed);
	const matchedSongId = kind !== "album" ? findReadyRadioMatch(trimmed) : null;
	sqlite
		.prepare(
			`
				INSERT INTO radio_requests (
					id,
					created_at,
					prompt,
					kind,
					status,
					matched_song_id,
					target_song_id,
					notification_state
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`,
		)
		.run(
			id,
			now,
			trimmed,
			kind,
			matchedSongId ? "ready" : "generating",
			matchedSongId,
			matchedSongId,
			"queued",
		);

	if (matchedSongId) {
		recomputeRadioSchedule("request-ready");
		emit("radio.request_updated", { requestId: id });
		return getRadioRequest(id);
	}

	const album = await createRadioAlbum({
		kind: "request",
		prompt: trimmed,
		requestId: id,
		targetTrackPrompt: trimmed,
	});
	const target = sqlite
		.prepare(
			"SELECT id FROM songs WHERE album_id = ? AND album_track_number = 4 LIMIT 1",
		)
		.get(album.id) as { id: string } | undefined;
	sqlite
		.prepare(
			`
				UPDATE radio_requests
				SET album_id = ?,
					target_song_id = ?
				WHERE id = ?
			`,
		)
		.run(album.id, target?.id ?? null, id);
	emit("radio.request_updated", { requestId: id });
	return getRadioRequest(id);
}

export function markRequestSongReady(songId: string) {
	const rows = sqlite
		.prepare(
			`
				SELECT id
				FROM radio_requests
				WHERE target_song_id = ?
					AND status IN ('pending', 'generating')
			`,
		)
		.all(songId) as Array<{ id: string }>;
	if (rows.length === 0) return;
	for (const row of rows) {
		sqlite
			.prepare(
				"UPDATE radio_requests SET status = 'ready', notification_state = 'ready' WHERE id = ?",
			)
			.run(row.id);
		emit("radio.request_updated", { requestId: row.id });
	}
	recomputeRadioSchedule("request-song-ready");
}

export function markRequestPlayedForSong(songId: string) {
	const rows = sqlite
		.prepare(
			"SELECT id FROM radio_requests WHERE target_song_id = ? AND status <> 'played'",
		)
		.all(songId) as Array<{ id: string }>;
	for (const row of rows) {
		sqlite
			.prepare(
				"UPDATE radio_requests SET status = 'played', notification_state = 'played' WHERE id = ?",
			)
			.run(row.id);
		emit("radio.request_updated", { requestId: row.id });
	}
}

export function getRadioRequest(id: string): RadioRequestWire | null {
	const row = sqlite
		.prepare("SELECT * FROM radio_requests WHERE id = ?")
		.get(id) as Record<string, unknown> | undefined;
	return row ? mapRequest(row) : null;
}

export function listRadioRequests(): RadioRequestWire[] {
	return (
		sqlite
			.prepare("SELECT * FROM radio_requests ORDER BY created_at DESC LIMIT 80")
			.all() as Array<Record<string, unknown>>
	).map(mapRequest);
}
