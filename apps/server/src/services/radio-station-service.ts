import { createId } from "@paralleldrive/cuid2";
import { sqlite } from "../db/index";
import { emit, on } from "../events/event-bus";
import { logger } from "../logger";
import {
	markAlbumFirstPlayed,
	markAlbumReadyIfComplete,
	RADIO_STATION_ID,
	RADIO_TRACK_DURATION_SECONDS,
	topUpInventory,
} from "./album-generation-service";
import {
	getScheduleSnapshot,
	pickNextScheduledSongId,
	recomputeRadioSchedule,
} from "./radio-mixer-service";
import {
	markRequestPlayedForSong,
	markRequestSongReady,
} from "./radio-request-service";
import { getActivePreset } from "./radio-station-presets-service";
import * as songService from "./song-service";

const LISTENER_STALE_MS = 25_000;
const ADVANCE_DRIFT_MS = 250;

interface ListenerState {
	active: boolean;
	lastSeenAt: number;
}

interface StationRow {
	id: string;
	currentSongId: string | null;
	currentPlayId: string | null;
	startedAt: number | null;
	pausedAt: number | null;
	pausedOffsetMs: number;
	isPlaying: number;
	activeListenerCount: number;
	scheduleVersion: number;
	inventoryTarget: number;
}

interface SongRow {
	id: string;
	title: string | null;
	artistName: string | null;
	albumId: string | null;
	albumTitle: string | null;
	albumTrackNumber: number | null;
	genre: string | null;
	vocalStyle: string | null;
	audioUrl: string | null;
	audioDuration: number | null;
	likeCount: number;
	dislikeCount: number;
	skipCount: number;
	radioPlayCount: number;
	coverUrl: string | null;
	coverWebpUrl: string | null;
	coverJxlUrl: string | null;
}

let advanceTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Map<string, ListenerState>();
let eventSyncStarted = false;
/** Latest background inventory top-up, tracked so tests can await it. */
let pendingInventoryTopUp: Promise<unknown> | null = null;

function nowMs() {
	return Date.now();
}

function coverFromSong(song: SongRow | null) {
	if (!song?.coverUrl && !song?.coverWebpUrl && !song?.coverJxlUrl) return null;
	return {
		pngUrl: song.coverUrl,
		webpUrl: song.coverWebpUrl,
		jxlUrl: song.coverJxlUrl,
	};
}

function getStationRow(): StationRow {
	ensureRadioStation();
	const row = sqlite
		.prepare(
			`
				SELECT
					id,
					current_song_id as currentSongId,
					current_play_id as currentPlayId,
					started_at as startedAt,
					paused_at as pausedAt,
					paused_offset_ms as pausedOffsetMs,
					is_playing as isPlaying,
					active_listener_count as activeListenerCount,
					schedule_version as scheduleVersion,
					inventory_target as inventoryTarget
				FROM radio_stations
				WHERE id = ?
			`,
		)
		.get(RADIO_STATION_ID) as StationRow | undefined;
	if (!row) throw new Error("Global radio station missing");
	return row;
}

function getCurrentSong(songId: string | null): SongRow | null {
	if (!songId) return null;
	return (
		(sqlite
			.prepare(
				`
					SELECT
						s.id,
						s.title,
						s.artist_name as artistName,
						s.album_id as albumId,
						a.title as albumTitle,
						s.album_track_number as albumTrackNumber,
						s.genre,
						s.vocal_style as vocalStyle,
						s.audio_url as audioUrl,
						s.audio_duration as audioDuration,
						COALESCE(s.like_count, 0) as likeCount,
						COALESCE(s.dislike_count, 0) as dislikeCount,
						COALESCE(s.skip_count, 0) as skipCount,
						COALESCE(s.radio_play_count, 0) as radioPlayCount,
						COALESCE(a.cover_url, s.cover_url) as coverUrl,
						COALESCE(a.cover_webp_url, s.cover_webp_url) as coverWebpUrl,
						COALESCE(a.cover_jxl_url, s.cover_jxl_url) as coverJxlUrl
					FROM songs s
					LEFT JOIN albums a ON a.id = s.album_id
					WHERE s.id = ?
				`,
			)
			.get(songId) as SongRow | undefined) ?? null
	);
}

function getDurationMs(song: SongRow | null): number {
	return Math.max(
		1,
		(song?.audioDuration ?? RADIO_TRACK_DURATION_SECONDS) * 1000,
	);
}

function getOffsetMs(station: StationRow, at = nowMs()): number {
	if (!station.isPlaying || !station.startedAt) {
		return Math.max(0, station.pausedOffsetMs ?? 0);
	}
	return Math.max(0, at - station.startedAt);
}

function activeListenerCountFromMemory(): number {
	return [...listeners.values()].filter((listener) => listener.active).length;
}

function persistActiveListenerCount(count = activeListenerCountFromMemory()) {
	sqlite
		.prepare(
			"UPDATE radio_stations SET active_listener_count = ?, updated_at = ? WHERE id = ?",
		)
		.run(count, nowMs(), RADIO_STATION_ID);
}

function clearAdvanceTimer() {
	if (advanceTimer) clearTimeout(advanceTimer);
	advanceTimer = null;
}

function scheduleAdvance() {
	clearAdvanceTimer();
	const station = getStationRow();
	const currentSong = getCurrentSong(station.currentSongId);
	if (!station.isPlaying || station.activeListenerCount <= 0 || !currentSong)
		return;
	const remainingMs = Math.max(
		0,
		getDurationMs(currentSong) - getOffsetMs(station),
	);
	advanceTimer = setTimeout(() => {
		advanceSong("completed").catch((err) => {
			logger.error({ err }, "Radio song advancement failed");
		});
	}, remainingMs + ADVANCE_DRIFT_MS);
	advanceTimer.unref?.();
}

function finishCurrentPlay(
	station: StationRow,
	outcome: "completed" | "skipped",
) {
	if (!station.currentPlayId) return;
	sqlite
		.prepare(
			`
				UPDATE radio_plays
				SET ended_at = ?,
					completed = ?,
					skipped = ?
				WHERE id = ? AND ended_at IS NULL
			`,
		)
		.run(
			nowMs(),
			outcome === "completed" ? 1 : 0,
			outcome === "skipped" ? 1 : 0,
			station.currentPlayId,
		);
}

function startSong(songId: string): SongRow | null {
	const song = getCurrentSong(songId);
	if (!song) return null;
	const station = getStationRow();
	const startedAt = nowMs();
	const playId = createId();

	sqlite.transaction(() => {
		finishCurrentPlay(station, "completed");
		sqlite
			.prepare(
				`
					INSERT INTO radio_plays (
						id,
						created_at,
						song_id,
						album_id,
						started_at,
						listener_count_snapshot
					) VALUES (?, ?, ?, ?, ?, ?)
				`,
			)
			.run(
				playId,
				startedAt,
				song.id,
				song.albumId,
				startedAt,
				station.activeListenerCount,
			);
		sqlite
			.prepare(
				`
					UPDATE songs
					SET radio_play_count = COALESCE(radio_play_count, 0) + 1,
						last_radio_played_at = ?
					WHERE id = ?
				`,
			)
			.run(startedAt, song.id);
		sqlite
			.prepare(
				`
					UPDATE radio_stations
					SET current_song_id = ?,
						current_play_id = ?,
						started_at = ?,
						paused_at = NULL,
						paused_offset_ms = 0,
						is_playing = ?,
						updated_at = ?
					WHERE id = ?
				`,
			)
			.run(
				song.id,
				playId,
				startedAt,
				station.activeListenerCount > 0 ? 1 : 0,
				startedAt,
				RADIO_STATION_ID,
			);
	})();

	markAlbumFirstPlayed(song.albumId, startedAt).catch((err) => {
		logger.warn({ err }, "markAlbumFirstPlayed failed");
	});
	markRequestPlayedForSong(song.id);
	recomputeRadioSchedule("song-start");
	// Replenish in the background; an LLM planner failure here must not
	// crash the song-start path with an unhandled rejection.
	pendingInventoryTopUp = topUpInventory().catch((err) => {
		logger.warn({ err }, "Radio inventory top-up failed");
	});
	scheduleAdvance();
	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return song;
}

async function startNextSong(): Promise<SongRow | null> {
	const nextSongId = pickNextScheduledSongId();
	if (!nextSongId) {
		const now = nowMs();
		// Clear the finished track too — leaving current_song_id set would
		// make the song-ready handler's "!station.currentSongId" auto-start
		// guard never fire, stranding listeners on the old song once new
		// tracks become ready.
		sqlite
			.prepare(
				`
					UPDATE radio_stations
					SET is_playing = 0,
						paused_at = ?,
						paused_offset_ms = 0,
						current_song_id = NULL,
						current_play_id = NULL,
						updated_at = ?
					WHERE id = ?
				`,
			)
			.run(now, now, RADIO_STATION_ID);
		clearAdvanceTimer();
		emit("radio.state_changed", { stationId: RADIO_STATION_ID });
		return null;
	}
	return startSong(nextSongId);
}

export function ensureRadioStation() {
	const now = nowMs();
	sqlite
		.prepare(
			`
				INSERT OR IGNORE INTO radio_stations (
					id,
					created_at,
					updated_at,
					paused_offset_ms,
					is_playing,
					active_listener_count,
					schedule_version,
					inventory_target
				) VALUES (?, ?, ?, 0, 0, 0, 0, 10)
			`,
		)
		.run(RADIO_STATION_ID, now, now);
}

export async function activateListener(listenerId: string) {
	ensureRadioStation();
	const previousCount = activeListenerCountFromMemory();
	listeners.set(listenerId, { active: true, lastSeenAt: nowMs() });
	const nextCount = activeListenerCountFromMemory();
	persistActiveListenerCount(nextCount);

	if (previousCount === 0 && nextCount > 0) {
		// Replenish in the background: album creation now runs LLM planner
		// calls that can take minutes, and pressing Play must not block on
		// them. The song.status_changed/radio.album_ready handlers start
		// playback once new tracks become ready.
		pendingInventoryTopUp = topUpInventory().catch((err) => {
			logger.warn({ err }, "Radio inventory top-up failed");
		});
		const station = getStationRow();
		if (station.currentSongId) {
			const currentSong = getCurrentSong(station.currentSongId);
			const durationMs = getDurationMs(currentSong);
			const offsetMs = Math.min(
				station.pausedOffsetMs,
				Math.max(0, durationMs - 1),
			);
			const now = nowMs();
			sqlite
				.prepare(
					`
						UPDATE radio_stations
						SET is_playing = 1,
							started_at = ?,
							paused_at = NULL,
							paused_offset_ms = ?,
							updated_at = ?
						WHERE id = ?
					`,
				)
				.run(now - offsetMs, offsetMs, now, RADIO_STATION_ID);
			scheduleAdvance();
		} else {
			await startNextSong();
		}
	} else {
		scheduleAdvance();
	}

	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return getStationSnapshot();
}

export function heartbeatListener(listenerId: string) {
	const listener = listeners.get(listenerId);
	if (listener?.active) {
		listener.lastSeenAt = nowMs();
	}
}

export function deactivateListener(listenerId: string) {
	const hadListener = listeners.delete(listenerId);
	if (!hadListener) return getStationSnapshot();
	const nextCount = activeListenerCountFromMemory();
	persistActiveListenerCount(nextCount);
	if (nextCount === 0) {
		pauseStationAtCurrentOffset();
	}
	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return getStationSnapshot();
}

function pauseStationAtCurrentOffset() {
	const station = getStationRow();
	const offsetMs = getOffsetMs(station);
	const now = nowMs();
	sqlite
		.prepare(
			`
				UPDATE radio_stations
				SET is_playing = 0,
					paused_at = ?,
					paused_offset_ms = ?,
					active_listener_count = 0,
					updated_at = ?
				WHERE id = ?
			`,
		)
		.run(now, offsetMs, now, RADIO_STATION_ID);
	clearAdvanceTimer();
}

export function seekStation(offsetSeconds: number) {
	const station = getStationRow();
	const currentSong = getCurrentSong(station.currentSongId);
	const durationMs = getDurationMs(currentSong);
	const offsetMs = Math.max(
		0,
		Math.min(Math.floor(offsetSeconds * 1000), Math.max(0, durationMs - 1)),
	);
	const now = nowMs();
	sqlite
		.prepare(
			`
				UPDATE radio_stations
				SET started_at = ?,
					paused_offset_ms = ?,
					updated_at = ?
				WHERE id = ?
			`,
		)
		.run(now - offsetMs, offsetMs, now, RADIO_STATION_ID);
	scheduleAdvance();
	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return getStationSnapshot();
}

export async function skipStation() {
	const station = getStationRow();
	if (station.currentSongId) {
		await songService.incrementRadioFeedback(station.currentSongId, "skip");
		finishCurrentPlay(station, "skipped");
	}
	const next = await startNextSong();
	if (!next) recomputeRadioSchedule("skip-empty");
	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return getStationSnapshot();
}

export async function advanceSong(
	outcome: "completed" | "skipped" = "completed",
) {
	const station = getStationRow();
	finishCurrentPlay(station, outcome);
	await startNextSong();
	return getStationSnapshot();
}

export async function addFeedback(songId: string, kind: "like" | "dislike") {
	if (!(await songService.incrementRadioFeedback(songId, kind))) return null;
	recomputeRadioSchedule(`feedback-${kind}`, { refineWithLlm: false });
	emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	return getStationSnapshot();
}

export function getStationSnapshot() {
	ensureRadioStation();
	const station = getStationRow();
	const currentSong = getCurrentSong(station.currentSongId);
	const serverTime = nowMs();
	const offsetMs = currentSong
		? Math.min(getOffsetMs(station, serverTime), getDurationMs(currentSong))
		: 0;
	return {
		station: {
			id: station.id,
			name: getActivePreset()?.name ?? "Infinitune Radio",
			isPlaying: Boolean(station.isPlaying),
			activeListenerCount: station.activeListenerCount,
			scheduleVersion: station.scheduleVersion,
			inventoryTarget: station.inventoryTarget,
			serverTime,
			offsetMs,
			startedAt: station.startedAt,
			pausedAt: station.pausedAt,
		},
		currentSong: currentSong
			? {
					...currentSong,
					cover: coverFromSong(currentSong),
					durationMs: getDurationMs(currentSong),
				}
			: null,
		schedule: getScheduleSnapshot(),
	};
}

export function startRadioServiceEventSync() {
	if (eventSyncStarted) return;
	eventSyncStarted = true;
	ensureRadioStation();
	sqlite
		.prepare(
			`
				UPDATE radio_stations
				SET active_listener_count = 0,
					is_playing = 0,
					paused_at = ?,
					updated_at = ?
				WHERE id = ?
			`,
		)
		.run(nowMs(), nowMs(), RADIO_STATION_ID);
	recomputeRadioSchedule("startup");
	on("song.status_changed", async ({ songId, to }) => {
		if (to !== "ready") return;
		const song = await songService.getById(songId);
		if (!song?.radioEligible) return;
		await markAlbumReadyIfComplete(song.albumId);
		markRequestSongReady(songId);
		recomputeRadioSchedule("song-ready");
		const station = getStationRow();
		if (station.activeListenerCount > 0 && !station.currentSongId) {
			await startNextSong();
		}
		emit("radio.state_changed", { stationId: RADIO_STATION_ID });
	});
	on("radio.album_ready", async () => {
		await topUpInventory();
		recomputeRadioSchedule("album-ready");
	});
	cleanupTimer = setInterval(
		() => {
			const cutoff = nowMs() - LISTENER_STALE_MS;
			let changed = false;
			for (const [listenerId, listener] of listeners.entries()) {
				if (listener.lastSeenAt < cutoff) {
					listeners.delete(listenerId);
					changed = true;
				}
			}
			if (!changed) return;
			const nextCount = activeListenerCountFromMemory();
			persistActiveListenerCount(nextCount);
			if (nextCount === 0) pauseStationAtCurrentOffset();
			emit("radio.state_changed", { stationId: RADIO_STATION_ID });
		},
		Math.max(5000, Math.floor(LISTENER_STALE_MS / 2)),
	);
	cleanupTimer.unref?.();
}

export function stopRadioRuntimeForTests() {
	clearAdvanceTimer();
	if (cleanupTimer) clearInterval(cleanupTimer);
	cleanupTimer = null;
	listeners.clear();
	eventSyncStarted = false;
}

/** Await any in-flight background inventory top-up (test-only). */
export async function flushInventoryTopUpForTests() {
	await pendingInventoryTopUp;
	pendingInventoryTopUp = null;
}
