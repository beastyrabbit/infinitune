import {
	DEFAULT_TEXT_PROVIDER,
	resolveTextLlmProfile,
} from "@infinitune/shared/text-llm-profile";
import { sqlite } from "../db/index";
import type { EventMap } from "../events/event-bus";
import { on } from "../events/event-bus";
import { batchPollAce, pollAce } from "../external/ace";
import type { RecentSong } from "../external/llm";
import { logger, playlistLogger, songLogger } from "../logger";
import * as playlistService from "../services/playlist-service";
import * as settingsService from "../services/settings-service";
import * as songService from "../services/song-service";
import type { PlaylistWire, SongWire } from "../wire";
import type { QueueStatus } from "./endpoint-queue";
import { calculatePriority, PERSONA_PRIORITY } from "./priority";
import { EndpointQueues } from "./queues";
import { createWorkerRuntime } from "./runtime/actor-runtime";
import {
	clearWorkerInspectionLog,
	getWorkerInspectionLog,
} from "./runtime/inspection";
import { createPlaylistActor } from "./runtime/playlist-actor";
import { ProviderRegistry } from "./runtime/provider-registry";
import { createSongActor } from "./runtime/song-actor";
import type { WorkerRuntimeEvent } from "./runtime/types";
import { SongWorker, type SongWorkerContext } from "./song-worker";

const AUDIO_POLL_INTERVAL = 2_000; // 2 seconds (ACE needs frequent polling)
const HEARTBEAT_STALE_MS = 90_000; // 90 seconds = 3 missed 30s heartbeats
function parsePositiveIntervalMs(
	value: string | undefined,
	defaultValue: number,
	minimumValue: number,
): number | undefined {
	const parsed = Number(value ?? defaultValue);
	if (!Number.isFinite(parsed) || parsed < minimumValue) return undefined;
	return Math.trunc(parsed);
}

const WORKER_DIAGNOSTICS_INTERVAL_MS = parsePositiveIntervalMs(
	process.env.WORKER_DIAGNOSTICS_INTERVAL_MS,
	30_000,
	5_000,
);
const WORKER_DIAGNOSTICS_ENABLED =
	process.env.NODE_ENV !== "test" &&
	process.env.WORKER_DIAGNOSTICS !== "0" &&
	WORKER_DIAGNOSTICS_INTERVAL_MS !== undefined;
const WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS = Number(
	process.env.WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS ?? 240_000,
);
const WORKER_DIAGNOSTICS_LOW_READY_THRESHOLD = Number(
	process.env.WORKER_DIAGNOSTICS_LOW_READY_THRESHOLD ?? 1,
);
const STALE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ─── State ───────────────────────────────────────────────────────────

/** Active song workers keyed by songId */
const songWorkers = new Map<string, SongWorker>();

/** Reverse index: playlist → set of active song IDs */
const playlistSongs = new Map<string, Set<string>>();

/** Last-seen promptEpoch per playlist */
const playlistEpochs = new Map<string, number>();

/** Per-playlist heartbeat timeout timers */
const heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Per-playlist buffer deficit guard */
const bufferLocks = new Map<string, boolean>();

let queues: EndpointQueues;
let workerRuntime: ReturnType<typeof createWorkerRuntime> | null = null;
const providerRegistry = new ProviderRegistry();
const busUnsubs = new Set<() => void>();
type PlaylistActorHandle = ReturnType<typeof createPlaylistActor>;
type SongActorHandle = ReturnType<typeof createSongActor>;

const playlistActors = new Map<string, PlaylistActorHandle>();
const songActors = new Map<string, SongActorHandle>();

// ─── Persona scan state ─────────────────────────────────────────────

const personaPending = new Set<string>();
let lastPersonaScanAt = 0;
const PERSONA_SCAN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let forcePersonaScan = false;

// ─── Actor orchestration ────────────────────────────────────────────

function routeSongEventToActor(
	event:
		| {
				type: "song.created";
				songId: string;
				playlistId: string;
				status: string;
		  }
		| {
				type: "song.status_changed";
				songId: string;
				playlistId: string;
				from: string;
				to: string;
		  },
) {
	let actor = songActors.get(event.songId);
	const shouldStop =
		event.type === "song.status_changed" &&
		(event.to === "ready" || event.to === "error" || event.to === "played");

	if (!actor) {
		actor = createSongActor({
			songId: event.songId,
			handlers: {
				handleSongCreated,
				handleSongStatusChanged,
				cancelSong: async (songId) => {
					cancelSongWorker(songId);
				},
				onStopped: () => {
					songActors.delete(event.songId);
				},
			},
		});
		songActors.set(event.songId, actor);
		actor.ref.start();
	}

	if (event.type === "song.created") {
		actor.ref.send({
			type: "song.created",
			songId: event.songId,
			playlistId: event.playlistId,
			status: event.status,
		});
		return;
	}

	actor.ref.send({
		type: "song.status_changed",
		songId: event.songId,
		playlistId: event.playlistId,
		from: event.from,
		to: event.to,
	});

	if (shouldStop) {
		actor.ref.send({ type: "song.actor.stop", songId: event.songId });
	}
}

function routePlaylistEventToActor(
	event:
		| { type: "playlist.created"; playlistId: string }
		| { type: "playlist.steered"; playlistId: string; newEpoch: number }
		| { type: "playlist.heartbeat"; playlistId: string }
		| { type: "playlist.updated"; playlistId: string }
		| { type: "playlist.deleted"; playlistId: string }
		| {
				type: "playlist.status_changed";
				playlistId: string;
				from: string;
				to: string;
		  },
) {
	let actor = playlistActors.get(event.playlistId);
	if (!actor) {
		actor = createPlaylistActor({
			playlistId: event.playlistId,
			handlers: {
				handlePlaylistCreated,
				handlePlaylistSteered,
				handlePlaylistHeartbeat,
				handlePlaylistUpdated,
				handlePlaylistDeleted,
				handlePlaylistStatusChanged,
				cancelPlaylistSongs: async (playlistId) => {
					cancelPlaylistWorkers(playlistId);
				},
				onStopped: () => {
					playlistActors.delete(event.playlistId);
				},
			},
		});
		playlistActors.set(event.playlistId, actor);
		actor.ref.start();
	}

	if (event.type === "playlist.created") {
		actor.ref.send({
			type: "playlist.created",
			playlistId: event.playlistId,
		});
		return;
	}

	if (event.type === "playlist.steered") {
		actor.ref.send({
			type: "playlist.steered",
			playlistId: event.playlistId,
			newEpoch: event.newEpoch,
		});
		return;
	}

	if (event.type === "playlist.heartbeat") {
		actor.ref.send({
			type: "playlist.heartbeat",
			playlistId: event.playlistId,
		});
		return;
	}

	if (event.type === "playlist.updated") {
		actor.ref.send({
			type: "playlist.updated",
			playlistId: event.playlistId,
		});
		return;
	}

	if (event.type === "playlist.deleted") {
		actor.ref.send({
			type: "playlist.deleted",
			playlistId: event.playlistId,
		});
		actor.ref.send({
			type: "playlist.actor.stop",
			playlistId: event.playlistId,
		});
		return;
	}

	actor.ref.send({
		type: "playlist.status_changed",
		playlistId: event.playlistId,
		from: event.from,
		to: event.to,
	});

	const shouldStop = event.to === "closed";

	if (shouldStop) {
		actor.ref.send({
			type: "playlist.actor.stop",
			playlistId: event.playlistId,
		});
	}
}

function stopAllActors() {
	for (const playlistId of playlistActors.keys()) {
		const actor = playlistActors.get(playlistId);
		actor?.ref.send({ type: "playlist.actor.stop", playlistId });
	}
	for (const songId of songActors.keys()) {
		const actor = songActors.get(songId);
		actor?.ref.send({ type: "song.actor.stop", songId });
	}
	playlistActors.clear();
	songActors.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function getSettings(): Promise<{
	textProvider: string;
	textModel: string;
	imageProvider: string;
	imageModel?: string;
	personaProvider: string;
	personaModel: string;
}> {
	const all = await settingsService.getAll();
	const textProvider = all.textProvider || DEFAULT_TEXT_PROVIDER;
	const textModel = all.textModel || "";
	const personaProvider = all.personaProvider || textProvider;
	const hasExplicitPersonaModel =
		Boolean(all.personaModel) && all.personaModel !== "__fallback__";
	const personaModel = hasExplicitPersonaModel
		? all.personaModel || ""
		: personaProvider === textProvider
			? textModel
			: "";

	return {
		textProvider,
		textModel,
		imageProvider: all.imageProvider || "comfyui",
		imageModel: all.imageModel ?? undefined,
		personaProvider,
		personaModel,
	};
}

/** Convert null fields to undefined for service function compatibility */
function toRecentSongs(
	items: Array<{
		title: string;
		artistName: string;
		genre: string;
		subGenre: string;
		vocalStyle: string | null;
		mood: string | null;
		energy: string | null;
	}>,
): RecentSong[] {
	return items.map((s) => ({
		title: s.title,
		artistName: s.artistName,
		genre: s.genre,
		subGenre: s.subGenre,
		vocalStyle: s.vocalStyle ?? undefined,
		mood: s.mood ?? undefined,
		energy: s.energy ?? undefined,
	}));
}

function safeMs(value: number | null | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return Math.round(value);
}

function summarizeQueueStatus(status: QueueStatus, now: number) {
	const oldestActiveStartedAt =
		status.activeItems.length > 0
			? Math.min(...status.activeItems.map((item) => item.startedAt))
			: undefined;
	const oldestPendingSince =
		status.pendingItems.length > 0
			? Math.min(...status.pendingItems.map((item) => item.waitingSince))
			: undefined;

	return {
		pending: status.pending,
		active: status.active,
		errors: status.errors,
		lastErrorMessage: status.lastErrorMessage,
		oldestActiveAgeMs: safeMs(
			oldestActiveStartedAt ? now - oldestActiveStartedAt : undefined,
		),
		oldestPendingAgeMs: safeMs(
			oldestPendingSince ? now - oldestPendingSince : undefined,
		),
		activeItems: status.activeItems.slice(0, 5).map((item) => ({
			songId: item.songId,
			priority: item.priority,
			endpoint: item.endpoint,
			ageMs: safeMs(now - item.startedAt),
		})),
		pendingItems: status.pendingItems.slice(0, 5).map((item) => ({
			songId: item.songId,
			priority: item.priority,
			endpoint: item.endpoint,
			waitMs: safeMs(now - item.waitingSince),
		})),
	};
}

function collectSongStatusCounts() {
	const rows = sqlite
		.prepare(
			"SELECT status as status, COUNT(*) as count FROM songs GROUP BY status ORDER BY count DESC",
		)
		.all() as Array<{ status: string; count: number }>;

	const byStatus = Object.fromEntries(
		rows.map((row) => [row.status, Number(row.count)]),
	);
	const total = rows.reduce((sum, row) => sum + Number(row.count), 0);

	return { total, byStatus };
}

function collectOldestTransientSongs(now: number, limit = 8) {
	const rows = sqlite
		.prepare(
			`
				SELECT
					id,
					playlist_id as playlistId,
					status,
					order_index as orderIndex,
					retry_count as retryCount,
					COALESCE(generation_started_at, created_at) as startedAt
				FROM songs
				WHERE status IN (
					'pending',
					'generating_metadata',
					'metadata_ready',
					'submitting_to_ace',
					'generating_audio',
					'saving',
					'retry_pending'
				)
				ORDER BY COALESCE(generation_started_at, created_at) ASC
				LIMIT ?
			`,
		)
		.all(limit) as Array<{
		id: string;
		playlistId: string;
		status: string;
		orderIndex: number;
		retryCount: number;
		startedAt: number;
	}>;

	return rows.map((row) => ({
		id: row.id,
		playlistId: row.playlistId,
		status: row.status,
		orderIndex: row.orderIndex,
		retryCount: row.retryCount ?? 0,
		ageMs: safeMs(now - row.startedAt),
	}));
}

function collectPlaylistFlow(now: number) {
	const rows = sqlite
		.prepare(
			`
				SELECT
					p.id as playlistId,
					p.status as playlistStatus,
					p.prompt_epoch as promptEpoch,
					p.current_order_index as currentOrderIndex,
					p.last_seen_at as lastSeenAt,
					COALESCE(SUM(CASE WHEN s.status = 'ready' THEN 1 ELSE 0 END), 0) as readyCount,
					COALESCE(SUM(CASE WHEN s.status = 'played' THEN 1 ELSE 0 END), 0) as playedCount,
					COALESCE(SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END), 0) as errorCount,
					COALESCE(SUM(CASE WHEN s.status = 'retry_pending' THEN 1 ELSE 0 END), 0) as retryPendingCount,
					COALESCE(SUM(CASE WHEN s.status IN (
						'pending',
						'generating_metadata',
						'metadata_ready',
						'submitting_to_ace',
						'generating_audio',
						'saving',
						'retry_pending'
					) THEN 1 ELSE 0 END), 0) as inFlightCount,
					MIN(CASE WHEN s.status IN (
						'pending',
						'generating_metadata',
						'metadata_ready',
						'submitting_to_ace',
						'generating_audio',
						'saving',
						'retry_pending'
					) THEN COALESCE(s.generation_started_at, s.created_at) END) as oldestInFlightStartedAt
				FROM playlists p
				LEFT JOIN songs s ON s.playlist_id = p.id
				WHERE p.status IN ('active', 'closing')
				GROUP BY p.id
				ORDER BY p.created_at DESC
			`,
		)
		.all() as Array<{
		playlistId: string;
		playlistStatus: string;
		promptEpoch: number | null;
		currentOrderIndex: number | null;
		lastSeenAt: number | null;
		readyCount: number;
		playedCount: number;
		errorCount: number;
		retryPendingCount: number;
		inFlightCount: number;
		oldestInFlightStartedAt: number | null;
	}>;

	return rows.map((row) => ({
		playlistId: row.playlistId,
		status: row.playlistStatus,
		promptEpoch: row.promptEpoch ?? 0,
		currentOrderIndex: row.currentOrderIndex ?? null,
		readyCount: Number(row.readyCount),
		playedCount: Number(row.playedCount),
		errorCount: Number(row.errorCount),
		retryPendingCount: Number(row.retryPendingCount),
		inFlightCount: Number(row.inFlightCount),
		heartbeatAgeMs: safeMs(
			row.lastSeenAt ? now - Number(row.lastSeenAt) : undefined,
		),
		oldestInFlightAgeMs: safeMs(
			row.oldestInFlightStartedAt
				? now - Number(row.oldestInFlightStartedAt)
				: undefined,
		),
	}));
}

async function logWorkerDiagnosticsSnapshot(
	reason: "startup" | "interval" = "interval",
) {
	if (!queues) return;

	const now = Date.now();
	const queueStatus = queues.getFullStatus();
	const queueSummary = {
		llm: summarizeQueueStatus(queueStatus.llm, now),
		image: summarizeQueueStatus(queueStatus.image, now),
		audio: summarizeQueueStatus(queueStatus.audio, now),
	};
	const songStatus = collectSongStatusCounts();
	const oldestTransientSongs = collectOldestTransientSongs(now);
	const playlistFlow = collectPlaylistFlow(now);
	const workerStats = getWorkerStats();

	logger.info(
		{
			reason,
			uptimeSec: Math.round(process.uptime()),
			intervalMs: WORKER_DIAGNOSTICS_INTERVAL_MS,
			worker: {
				songWorkers: workerStats.songWorkerCount,
				trackedPlaylists: workerStats.trackedPlaylists.length,
			},
			queues: queueSummary,
			songs: {
				total: songStatus.total,
				byStatus: songStatus.byStatus,
				oldestTransient: oldestTransientSongs,
			},
			playlists: playlistFlow,
		},
		"Worker diagnostics snapshot",
	);

	const longQueueItems = [
		{
			queue: "llm",
			oldestActiveAgeMs: queueSummary.llm.oldestActiveAgeMs,
			oldestPendingAgeMs: queueSummary.llm.oldestPendingAgeMs,
		},
		{
			queue: "audio",
			oldestActiveAgeMs: queueSummary.audio.oldestActiveAgeMs,
			oldestPendingAgeMs: queueSummary.audio.oldestPendingAgeMs,
		},
	].filter(
		(item) =>
			(item.oldestActiveAgeMs ?? 0) >= WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS ||
			(item.oldestPendingAgeMs ?? 0) >= WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS,
	);

	if (longQueueItems.length > 0) {
		logger.warn(
			{
				warnAfterMs: WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS,
				queues: longQueueItems,
			},
			"Long-running queue items detected",
		);
	}

	const lowBufferPlaylists = playlistFlow.filter(
		(playlist) =>
			playlist.status === "active" &&
			playlist.inFlightCount > 0 &&
			playlist.readyCount <= WORKER_DIAGNOSTICS_LOW_READY_THRESHOLD,
	);
	if (lowBufferPlaylists.length > 0) {
		logger.warn(
			{
				readyThreshold: WORKER_DIAGNOSTICS_LOW_READY_THRESHOLD,
				playlists: lowBufferPlaylists,
			},
			"Playlist buffer is tight",
		);
	}
}

function getRuntimeQueueSnapshot() {
	if (!queues) {
		return {
			llm: { pending: 0, active: 0, errors: 0 },
			image: { pending: 0, active: 0, errors: 0 },
			audio: { pending: 0, active: 0, errors: 0 },
		};
	}

	const now = Date.now();
	const full = queues.getFullStatus();
	return {
		llm: {
			pending: full.llm.pending,
			active: full.llm.active,
			errors: full.llm.errors,
			oldestActiveAgeMs:
				full.llm.activeItems.length > 0
					? safeMs(
							now -
								Math.min(...full.llm.activeItems.map((item) => item.startedAt)),
						)
					: undefined,
			oldestPendingAgeMs:
				full.llm.pendingItems.length > 0
					? safeMs(
							now -
								Math.min(
									...full.llm.pendingItems.map((item) => item.waitingSince),
								),
						)
					: undefined,
		},
		image: {
			pending: full.image.pending,
			active: full.image.active,
			errors: full.image.errors,
			oldestActiveAgeMs:
				full.image.activeItems.length > 0
					? safeMs(
							now -
								Math.min(
									...full.image.activeItems.map((item) => item.startedAt),
								),
						)
					: undefined,
			oldestPendingAgeMs:
				full.image.pendingItems.length > 0
					? safeMs(
							now -
								Math.min(
									...full.image.pendingItems.map((item) => item.waitingSince),
								),
						)
					: undefined,
		},
		audio: {
			pending: full.audio.pending,
			active: full.audio.active,
			errors: full.audio.errors,
			oldestActiveAgeMs:
				full.audio.activeItems.length > 0
					? safeMs(
							now -
								Math.min(
									...full.audio.activeItems.map((item) => item.startedAt),
								),
						)
					: undefined,
			oldestPendingAgeMs:
				full.audio.pendingItems.length > 0
					? safeMs(
							now -
								Math.min(
									...full.audio.pendingItems.map((item) => item.waitingSince),
								),
						)
					: undefined,
		},
	};
}

function getWorkerRuntime() {
	if (workerRuntime) return workerRuntime;
	workerRuntime = createWorkerRuntime({
		handlers: {
			handleSongCreated: async (event) => {
				await Promise.resolve(
					routeSongEventToActor({ type: "song.created", ...event }),
				);
			},
			handleSongStatusChanged: async (event) => {
				await Promise.resolve(
					routeSongEventToActor({ type: "song.status_changed", ...event }),
				);
			},
			handlePlaylistCreated: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({ type: "playlist.created", ...event }),
				);
			},
			handlePlaylistSteered: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({ type: "playlist.steered", ...event }),
				);
			},
			handlePlaylistHeartbeat: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({ type: "playlist.heartbeat", ...event }),
				);
			},
			handlePlaylistUpdated: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({ type: "playlist.updated", ...event }),
				);
			},
			handlePlaylistDeleted: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({ type: "playlist.deleted", ...event }),
				);
			},
			handlePlaylistStatusChanged: async (event) => {
				await Promise.resolve(
					routePlaylistEventToActor({
						type: "playlist.status_changed",
						...event,
					}),
				);
			},
			handleSettingsChanged,
			reconcileAceState,
			startupSweep,
			tickAudioPolls: async () => {
				if (!queues) return;
				await queues.audio.tickPolls();
			},
			staleSongCleanup,
			logWorkerDiagnostics: async (reason) => {
				await logWorkerDiagnosticsSnapshot(reason);
			},
		},
		enableDiagnostics: WORKER_DIAGNOSTICS_ENABLED,
		diagnosticsIntervalMs: WORKER_DIAGNOSTICS_INTERVAL_MS,
		audioPollIntervalMs: AUDIO_POLL_INTERVAL,
		staleCleanupIntervalMs: STALE_CLEANUP_INTERVAL_MS,
		getQueueSnapshot: getRuntimeQueueSnapshot,
	});
	return workerRuntime;
}

function subscribeRuntimeEventBus() {
	if (busUnsubs.size > 0) return;

	const subscribe = <K extends keyof EventMap>(
		event: K,
		transform: (data: EventMap[K]) => WorkerRuntimeEvent,
	) => {
		const unsub = on(event, (data) => {
			if (!workerRuntime) return;
			workerRuntime.send(transform(data as EventMap[K]));
		});
		busUnsubs.add(unsub);
	};

	subscribe("song.created", (data) => ({ type: "song.created", ...data }));
	subscribe("song.status_changed", (data) => ({
		type: "song.status_changed",
		...data,
	}));
	subscribe("playlist.created", (data) => ({
		type: "playlist.created",
		...data,
	}));
	subscribe("playlist.steered", (data) => ({
		type: "playlist.steered",
		...data,
	}));
	subscribe("playlist.heartbeat", (data) => ({
		type: "playlist.heartbeat",
		...data,
	}));
	subscribe("playlist.updated", (data) => ({
		type: "playlist.updated",
		...data,
	}));
	subscribe("playlist.deleted", (data) => ({
		type: "playlist.deleted",
		...data,
	}));
	subscribe("playlist.status_changed", (data) => ({
		type: "playlist.status_changed",
		...data,
	}));
	subscribe("settings.changed", (data) => ({
		type: "settings.changed",
		...data,
	}));
}

/** Create a SongWorker for a song and register it */
async function spawnSongWorker(
	song: SongWire,
	playlist: PlaylistWire,
	workQueue: {
		recentCompleted: Array<{
			title: string;
			artistName: string;
			genre: string;
			subGenre: string;
			vocalStyle: string | null;
			mood: string | null;
			energy: string | null;
		}>;
		recentDescriptions: string[];
	},
): Promise<void> {
	if (songWorkers.has(song.id)) return; // Already tracked

	const playlistId = playlist.id;
	const ctx: SongWorkerContext = {
		queues,
		playlist,
		recentSongs: toRecentSongs(workQueue.recentCompleted),
		recentDescriptions: workQueue.recentDescriptions,
		getPlaylistActive: async () => {
			const pl = await playlistService.getById(playlistId);
			return pl?.status === "active";
		},
		getCurrentEpoch: () => playlistEpochs.get(playlistId) ?? 0,
		getSettings,
		capabilities: providerRegistry.textCapability,
	};

	const worker = new SongWorker(song, ctx);
	songWorkers.set(song.id, worker);

	// Track song → playlist for reverse lookup
	let songSet = playlistSongs.get(playlistId);
	if (!songSet) {
		songSet = new Set();
		playlistSongs.set(playlistId, songSet);
	}
	songSet.add(song.id);

	// Fire-and-forget
	worker.run().finally(() => {
		songWorkers.delete(song.id);
		const set = playlistSongs.get(playlistId);
		if (set) {
			set.delete(song.id);
			if (set.size === 0) playlistSongs.delete(playlistId);
		}
	});
}

function cancelPlaylistWorkers(playlistId: string): void {
	const songIds = playlistSongs.get(playlistId);
	if (songIds) {
		for (const songId of songIds) {
			cancelSongWorker(songId);
		}
	}
	playlistSongs.delete(playlistId);
}

function cancelSongWorker(songId: string): void {
	const worker = songWorkers.get(songId);
	if (!worker) return;

	worker.cancel();

	songWorkers.delete(songId);

	for (const [playlistId, songSet] of playlistSongs.entries()) {
		if (songSet.delete(songId) && songSet.size === 0) {
			playlistSongs.delete(playlistId);
			break;
		}
	}
}

// ─── Heartbeat management ───────────────────────────────────────────

function resetHeartbeatTimer(playlistId: string): void {
	const existing = heartbeatTimers.get(playlistId);
	if (existing) clearTimeout(existing);

	const timer = setTimeout(async () => {
		heartbeatTimers.delete(playlistId);
		try {
			const pl = await playlistService.getById(playlistId);
			if (pl?.status === "active") {
				playlistLogger(playlistId).info(
					{ staleSec: Math.round(HEARTBEAT_STALE_MS / 1000) },
					"Playlist stale (no heartbeat), setting to closing",
				);
				await playlistService.updateStatus(playlistId, "closing");
			}
		} catch (err) {
			playlistLogger(playlistId).error({ err }, "Heartbeat timeout error");
		}
	}, HEARTBEAT_STALE_MS);

	heartbeatTimers.set(playlistId, timer);
}

function clearHeartbeatTimer(playlistId: string): void {
	const timer = heartbeatTimers.get(playlistId);
	if (timer) {
		clearTimeout(timer);
		heartbeatTimers.delete(playlistId);
	}
}

// ─── Buffer management ──────────────────────────────────────────────

async function checkBufferDeficit(playlistId: string): Promise<void> {
	if (bufferLocks.get(playlistId)) return; // Another check already running
	bufferLocks.set(playlistId, true);
	try {
		const playlist = await playlistService.getById(playlistId);
		if (!playlist || playlist.status !== "active") return;

		const isOneshot = playlist.mode === "oneshot";
		const workQueue = await songService.getWorkQueue(playlistId);

		const shouldCreateSong = isOneshot
			? workQueue.totalSongs === 0
			: workQueue.bufferDeficit > 0;

		if (shouldCreateSong) {
			const count = isOneshot ? 1 : workQueue.bufferDeficit;
			for (let i = 0; i < count; i++) {
				const orderIndex = Math.ceil(workQueue.maxOrderIndex) + 1 + i;
				await songService.createPending(playlistId, orderIndex, {
					promptEpoch: playlist.promptEpoch ?? 0,
				});
				playlistLogger(playlistId).debug(
					{
						orderIndex,
						deficit: workQueue.bufferDeficit,
						epoch: playlist.promptEpoch ?? 0,
					},
					"Created pending song",
				);
			}
		}

		// Oneshot auto-close: if no transient work remains
		if (
			isOneshot &&
			playlist.status === "active" &&
			workQueue.transientCount === 0 &&
			workQueue.totalSongs > 0
		) {
			playlistLogger(playlistId).info(
				"Oneshot playlist complete, setting to closing",
			);
			await playlistService.updateStatus(playlistId, "closing");
		}
	} finally {
		bufferLocks.delete(playlistId);
	}
}

// ─── Persona scan ───────────────────────────────────────────────────

async function runPersonaScan(
	settings: Awaited<ReturnType<typeof getSettings>>,
) {
	const needsPersona = await songService.getNeedsPersona();
	if (needsPersona.length === 0) return;

	const { provider: pProvider, model: pModel } = resolveTextLlmProfile({
		provider: settings.personaProvider,
		model: settings.personaModel,
	});
	if (pProvider === "openrouter" && !pModel.trim()) {
		logger.warn(
			"Skipping persona scan: OpenRouter persona provider requires an explicit persona model",
		);
		return;
	}

	for (const song of needsPersona) {
		if (personaPending.has(song.id)) continue;
		personaPending.add(song.id);
		songLogger(song.id).debug({ title: song.title }, "Queuing persona extract");

		queues.llm
			.enqueue({
				songId: song.id,
				priority: PERSONA_PRIORITY,
				endpoint: pProvider,
				execute: async (signal) => {
					return await providerRegistry.textCapability.generatePersona({
						song: {
							title: song.title,
							artistName: song.artistName ?? "",
							genre: song.genre ?? "",
							subGenre: song.subGenre ?? "",
							mood: song.mood ?? undefined,
							energy: song.energy ?? undefined,
							era: song.era ?? undefined,
							vocalStyle: song.vocalStyle ?? undefined,
							instruments: song.instruments ?? undefined,
							themes: song.themes ?? undefined,
							description: song.description ?? undefined,
							lyrics: song.lyrics?.slice(0, 500) ?? undefined,
						},
						provider: pProvider,
						model: pModel,
						signal,
					});
				},
			})
			.then(async ({ result, processingMs }) => {
				await songService.updatePersonaExtract(song.id, result as string);
				songLogger(song.id).info(
					{ title: song.title, processingMs },
					"Persona extract complete",
				);
			})
			.catch((err) => {
				songLogger(song.id).error(
					{ err, title: song.title },
					"Persona extract failed",
				);
			})
			.finally(() => {
				personaPending.delete(song.id);
			});
	}

	lastPersonaScanAt = Date.now();
}

export function triggerPersonaScan() {
	forcePersonaScan = true;
	// Schedule a persona scan immediately
	getSettings()
		.then((settings) => runPersonaScan(settings))
		.catch((err) => logger.error({ err }, "Triggered persona scan error"));
}

// ─── Event handlers ─────────────────────────────────────────────────

async function handleSongCreated(data: {
	songId: string;
	playlistId: string;
	status: string;
}) {
	if (data.status !== "pending" && data.status !== "metadata_ready") return;

	const song = (await songService.getByIds([data.songId]))[0];
	if (!song) return;

	const playlist = await playlistService.getById(data.playlistId);
	if (!playlist) return;

	// Use getWorkQueue to get context for the worker
	const workQueue = await songService.getWorkQueue(data.playlistId);
	const playlistWire = (await playlistService.listActive()).find(
		(p) => p.id === data.playlistId,
	);
	if (!playlistWire) return;

	songLogger(data.songId, data.playlistId).info(
		{ status: data.status },
		"Spawning SongWorker",
	);
	await spawnSongWorker(song, playlistWire, workQueue);
}

async function handleSongStatusChanged(data: {
	songId: string;
	playlistId: string;
	from: string;
	to: string;
}) {
	const { songId, playlistId, to } = data;

	// Song became ready → check if buffer needs more songs
	if (to === "ready") {
		await checkBufferDeficit(playlistId);

		// Also trigger persona scan if overdue
		const now = Date.now();
		if (forcePersonaScan || now - lastPersonaScanAt > PERSONA_SCAN_INTERVAL) {
			forcePersonaScan = false;
			getSettings()
				.then((settings) => runPersonaScan(settings))
				.catch((err) => logger.error({ err }, "Persona scan error"));
		}
	}

	// Song entered retry_pending → auto-retry
	if (to === "retry_pending") {
		try {
			await songService.retryErrored(songId);
			songLogger(songId, playlistId).info(
				{ from: data.from, to: data.to },
				"Auto-retried song",
			);
		} catch (err) {
			songLogger(songId, playlistId).error({ err }, "Failed to retry song");
		}
	}

	// Song reverted to actionable state (from retry, revert, etc.) → spawn worker
	if (
		(to === "pending" || to === "metadata_ready") &&
		!songWorkers.has(songId)
	) {
		const song = (await songService.getByIds([songId]))[0];
		if (!song) return;

		const playlistWire = (await playlistService.listActive()).find(
			(p) => p.id === playlistId,
		);
		if (!playlistWire) return;

		const workQueue = await songService.getWorkQueue(playlistId);
		await spawnSongWorker(song, playlistWire, workQueue);
	}

	// Closing playlist: check if all transient work is done
	if (to === "ready" || to === "error") {
		const playlist = await playlistService.getById(playlistId);
		if (playlist?.status === "closing") {
			const workQueue = await songService.getWorkQueue(playlistId);
			if (workQueue.transientCount === 0) {
				playlistLogger(playlistId).info(
					"Playlist closing complete, setting to closed",
				);
				await playlistService.updateStatus(playlistId, "closed");
				cancelPlaylistWorkers(playlistId);
				clearHeartbeatTimer(playlistId);
				playlistEpochs.delete(playlistId);
			}
		}
	}
}

async function handlePlaylistCreated(data: { playlistId: string }) {
	const playlist = await playlistService.getById(data.playlistId);
	if (!playlist || playlist.status !== "active") return;

	playlistEpochs.set(data.playlistId, playlist.promptEpoch ?? 0);

	// Start heartbeat timer
	resetHeartbeatTimer(data.playlistId);

	// Create initial buffer songs
	await checkBufferDeficit(data.playlistId);
}

async function handlePlaylistSteered(data: {
	playlistId: string;
	newEpoch: number;
}) {
	const { playlistId, newEpoch } = data;
	const lastSeenEpoch = playlistEpochs.get(playlistId) ?? 0;
	playlistEpochs.set(playlistId, newEpoch);

	if (newEpoch <= lastSeenEpoch) return;

	playlistLogger(playlistId).info(
		{ from: lastSeenEpoch, to: newEpoch },
		"Epoch changed",
	);

	const playlist = await playlistService.getById(playlistId);
	if (!playlist) return;

	const isOneshot = playlist.mode === "oneshot";
	const isClosing = playlist.status === "closing";
	const workQueue = await songService.getWorkQueue(playlistId);

	// Delete old-epoch pending songs
	const oldPending = workQueue.pending.filter(
		(s) => (s.promptEpoch ?? 0) < newEpoch && !s.isInterrupt,
	);
	for (const song of oldPending) {
		const w = songWorkers.get(song.id);
		if (w) w.cancel();
		await songService.deleteSong(song.id);
		songLogger(song.id, playlistId).debug(
			{ songEpoch: song.promptEpoch ?? 0, newEpoch },
			"Deleted old-epoch pending song",
		);
	}

	// Recalculate priorities for remaining queued songs
	const allSongs = [
		...workQueue.pending,
		...workQueue.metadataReady,
		...workQueue.generatingAudio,
		...workQueue.needsRecovery,
	];
	const songMap = new Map(allSongs.map((s) => [s.id, s]));

	queues.recalcPendingPriorities((songId) => {
		const song = songMap.get(songId);
		if (!song) return undefined;
		return calculatePriority({
			isOneshot,
			isInterrupt: !!song.interruptPrompt,
			orderIndex: song.orderIndex,
			currentOrderIndex: playlist.currentOrderIndex ?? 0,
			isClosing,
			currentEpoch: newEpoch,
			songEpoch: song.promptEpoch ?? 0,
		});
	});

	// Create new songs for the new epoch
	await checkBufferDeficit(playlistId);
}

async function handlePlaylistHeartbeat(data: { playlistId: string }) {
	resetHeartbeatTimer(data.playlistId);
}

async function handlePlaylistUpdated(data: { playlistId: string }) {
	// Position changed (user skipped/jumped) → check if buffer needs more songs
	await checkBufferDeficit(data.playlistId);
}

async function handlePlaylistDeleted(data: { playlistId: string }) {
	cancelPlaylistWorkers(data.playlistId);
	clearHeartbeatTimer(data.playlistId);
	playlistEpochs.delete(data.playlistId);
	bufferLocks.delete(data.playlistId);
}

async function handlePlaylistStatusChanged(data: {
	playlistId: string;
	from: string;
	to: string;
}) {
	const { playlistId, from, to } = data;

	if (to === "closing") {
		// Check if we can close immediately (no transient work)
		const workQueue = await songService.getWorkQueue(playlistId);
		if (workQueue.transientCount === 0) {
			playlistLogger(playlistId).info(
				"Playlist closing immediately (no transient work)",
			);
			await playlistService.updateStatus(playlistId, "closed");
			cancelPlaylistWorkers(playlistId);
			clearHeartbeatTimer(playlistId);
			playlistEpochs.delete(playlistId);
		}
	}

	if (to === "closed") {
		cancelPlaylistWorkers(playlistId);
		clearHeartbeatTimer(playlistId);
		playlistEpochs.delete(playlistId);
	}

	if (to === "active" && (from === "closing" || from === "closed")) {
		// Re-activate heartbeat timer on reactivation
		resetHeartbeatTimer(playlistId);
		// Re-check buffer deficit
		await checkBufferDeficit(playlistId);
	}
}

async function handleSettingsChanged(_data: { key: string }) {
	try {
		const settings = await getSettings();
		queues.refreshAll(settings);
		providerRegistry.refresh(settings);
	} catch (err) {
		logger.error({ err }, "Failed to refresh settings");
	}
}

// ─── Stale song cleanup (periodic) ─────────────────────────────────

async function staleSongCleanup(): Promise<void> {
	try {
		const activePlaylists = await playlistService.listActive();
		for (const playlist of activePlaylists) {
			const workQueue = await songService.getWorkQueue(playlist.id);
			if (workQueue.staleSongs.length > 0) {
				for (const stale of workQueue.staleSongs) {
					songLogger(stale.id, playlist.id).info(
						{ title: stale.title, status: stale.status },
						"Removing stuck song",
					);
					const w = songWorkers.get(stale.id);
					if (w) w.cancel();
					await songService.deleteSong(stale.id);
				}
			}
		}
	} catch (err) {
		logger.error({ err }, "Stale cleanup error");
	}
}

// ─── Startup ACE reconciliation ─────────────────────────────────────

async function reconcileAceState() {
	const songs = await songService.getInAudioPipeline();
	if (songs.length === 0) return;

	logger.info({ count: songs.length }, "Reconciling songs in audio pipeline");

	const taskIds = songs.flatMap((s) => (s.aceTaskId ? [s.aceTaskId] : []));

	if (taskIds.length > 0) {
		let aceStatus: Map<string, { status: string; audioPath?: string }>;
		try {
			aceStatus = await batchPollAce(taskIds);
		} catch (_error: unknown) {
			logger.warn(
				{ count: songs.length },
				"ACE unreachable, reverting all songs to metadata_ready",
			);
			for (const song of songs) {
				await songService.revertTransient(song.id);
			}
			return;
		}

		for (const song of songs) {
			if (!song.aceTaskId) {
				await songService.revertTransient(song.id);
				songLogger(song.id).info("Reverted — no ACE task ID");
				continue;
			}
			const status = aceStatus.get(song.aceTaskId);
			if (
				!status ||
				status.status === "not_found" ||
				status.status === "failed"
			) {
				await songService.revertTransient(song.id);
				songLogger(song.id).info(
					{ aceTaskId: song.aceTaskId },
					"Reverted — ACE task is gone",
				);
			} else if (status.status === "succeeded" && status.audioPath) {
				songLogger(song.id).info(
					{ aceTaskId: song.aceTaskId },
					"ACE task already done — SongWorker will save",
				);
			} else {
				songLogger(song.id).info(
					{ aceTaskId: song.aceTaskId },
					"ACE task still running — will resume",
				);
			}
		}
	} else {
		for (const song of songs) {
			await songService.revertTransient(song.id);
			songLogger(song.id).info("Reverted — no ACE task ID");
		}
	}
}

/** Startup sweep: spawn workers for all actionable songs across active playlists */
async function startupSweep() {
	const activePlaylists = await playlistService.listActive();
	logger.info(
		{ count: activePlaylists.length },
		"Active/closing playlists at startup",
	);

	for (const playlist of activePlaylists) {
		playlistEpochs.set(playlist.id, playlist.promptEpoch ?? 0);

		// Start heartbeat timer for active playlists
		if (playlist.status === "active") {
			resetHeartbeatTimer(playlist.id);
		}

		const workQueue = await songService.getWorkQueue(playlist.id);
		const currentEpoch = playlist.promptEpoch ?? 0;

		// Spawn workers for actionable songs
		const actionableSongs = [
			...workQueue.pending,
			...workQueue.metadataReady,
			...workQueue.generatingAudio,
			...workQueue.needsRecovery,
		].sort((a, b) => {
			// Prioritize current-epoch songs
			const aEpoch = (a.promptEpoch ?? 0) === currentEpoch ? 0 : 1;
			const bEpoch = (b.promptEpoch ?? 0) === currentEpoch ? 0 : 1;
			return aEpoch - bEpoch;
		});

		for (const song of actionableSongs) {
			await spawnSongWorker(song, playlist, workQueue);
		}

		// Handle stale songs
		if (workQueue.staleSongs.length > 0) {
			for (const stale of workQueue.staleSongs) {
				songLogger(stale.id, playlist.id).info(
					{ title: stale.title, status: stale.status },
					"[startup] Removing stuck song",
				);
				const w = songWorkers.get(stale.id);
				if (w) w.cancel();
				await songService.deleteSong(stale.id);
			}
		}

		// Process retries
		for (const song of workQueue.retryPending) {
			songLogger(song.id, playlist.id).info(
				{ retryCount: (song.retryCount || 0) + 1 },
				"[startup] Retrying song",
			);
			await songService.retryErrored(song.id);
		}

		// Check buffer deficit for active playlists
		if (playlist.status === "active") {
			await checkBufferDeficit(playlist.id);
		}

		// Closing check
		if (playlist.status === "closing" && workQueue.transientCount === 0) {
			playlistLogger(playlist.id).info(
				"[startup] Playlist closing complete, setting to closed",
			);
			await playlistService.updateStatus(playlist.id, "closed");
		}
	}
}

// ─── Startup ─────────────────────────────────────────────────────────

export async function startWorker(): Promise<void> {
	logger.info("Starting event-driven song generation worker...");

	// Initialize endpoint queues
	queues = new EndpointQueues((taskId, signal) => pollAce(taskId, signal));

	// Refresh queue concurrency from settings
	try {
		const settings = await getSettings();
		queues.refreshAll(settings);
		providerRegistry.refresh(settings);
	} catch (err) {
		logger.warn({ err }, "Could not load initial settings, using defaults");
	}

	subscribeRuntimeEventBus();
	const runtime = getWorkerRuntime();
	await runtime.start();

	logger.info("Worker started, listening on event bus");

	if (WORKER_DIAGNOSTICS_ENABLED) {
		logger.info(
			{
				intervalMs: WORKER_DIAGNOSTICS_INTERVAL_MS,
				oldItemWarnMs: WORKER_DIAGNOSTICS_OLD_ITEM_WARN_MS,
				lowReadyThreshold: WORKER_DIAGNOSTICS_LOW_READY_THRESHOLD,
			},
			"Worker diagnostics enabled",
		);
	} else if (process.env.NODE_ENV !== "test") {
		logger.warn(
			{
				intervalMs: process.env.WORKER_DIAGNOSTICS_INTERVAL_MS,
				enabled: process.env.WORKER_DIAGNOSTICS,
			},
			"Worker diagnostics disabled",
		);
	}
}

/** Expose queues for status API */
export function getQueues(): EndpointQueues {
	return queues;
}

/** Expose worker counts for status API */
export function getWorkerStats() {
	const snapshot = workerRuntime?.getSnapshot();
	return {
		songWorkerCount: Math.max(
			songWorkers.size,
			snapshot?.songActors.length ?? songActors.size,
		),
		trackedPlaylists:
			snapshot?.playlistActors ??
			Array.from(new Set([...playlistActors.keys(), ...playlistEpochs.keys()])),
		actorRuntime: {
			playlists: Array.from(playlistActors.entries()).map(
				([playlistId, actor]) => {
					const { playlistId: _actorPlaylistId, ...snapshot } =
						actor.getSnapshot();
					return {
						playlistId,
						...snapshot,
					};
				},
			),
			songs: Array.from(songActors.entries()).map(([songId, actor]) => {
				const { songId: _actorSongId, ...snapshot } = actor.getSnapshot();
				return {
					songId,
					...snapshot,
				};
			}),
		},
	};
}

export function getWorkerActorGraph() {
	return {
		playlists: Array.from(playlistActors.entries()).map(
			([playlistId, actor]) => {
				const { playlistId: _actorPlaylistId, ...snapshot } =
					actor.getSnapshot();
				return {
					playlistId,
					status: snapshot.status,
					eventsHandled: snapshot.eventsHandled,
					lastEvent: snapshot.lastEvent,
					lastEventAt: snapshot.lastEventAt,
				};
			},
		),
		songs: Array.from(songActors.entries()).map(([songId, actor]) => {
			const { songId: _actorSongId, ...snapshot } = actor.getSnapshot();
			return {
				songId,
				status: snapshot.status,
				eventsHandled: snapshot.eventsHandled,
				lastEvent: snapshot.lastEvent,
				lastEventAt: snapshot.lastEventAt,
			};
		}),
	};
}

/** Stop diagnostics timers (used by graceful shutdown). */
export function stopWorkerDiagnostics() {
	for (const timer of heartbeatTimers.values()) {
		clearTimeout(timer);
	}
	heartbeatTimers.clear();
	bufferLocks.clear();
	playlistSongs.clear();
	songWorkers.clear();
	playlistEpochs.clear();
	for (const unsub of busUnsubs) unsub();
	busUnsubs.clear();
	stopAllActors();
	workerRuntime?.stop();
	workerRuntime = null;
	clearWorkerInspectionLog();
}

export function getWorkerInspect(limit?: number) {
	return getWorkerInspectionLog(limit);
}

/** @internal — exported for unit tests only */
export const _test = {
	handleSongCreated,
	handleSongStatusChanged,
	handlePlaylistCreated,
	handlePlaylistSteered,
	handlePlaylistHeartbeat,
	handlePlaylistUpdated,
	handlePlaylistDeleted,
	handlePlaylistStatusChanged,
	handleSettingsChanged,
	checkBufferDeficit,
	setQueues(q: EndpointQueues) {
		queues = q;
	},
	setPlaylistEpoch(playlistId: string, epoch: number) {
		playlistEpochs.set(playlistId, epoch);
	},
	reset() {
		stopWorkerDiagnostics();
		songWorkers.clear();
		playlistSongs.clear();
		playlistEpochs.clear();
		playlistActors.clear();
		songActors.clear();
		for (const t of heartbeatTimers.values()) clearTimeout(t);
		heartbeatTimers.clear();
		bufferLocks.clear();
		personaPending.clear();
		lastPersonaScanAt = 0;
		forcePersonaScan = false;
	},
};
