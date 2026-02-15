import { on } from "../events/event-bus";
import { batchPollAce, pollAce } from "../external/ace";
import { generatePersonaExtract, type RecentSong } from "../external/llm";
import * as playlistService from "../services/playlist-service";
import * as settingsService from "../services/settings-service";
import * as songService from "../services/song-service";
import type { PlaylistWire, SongWire } from "../wire";
import { calculatePriority, PERSONA_PRIORITY } from "./priority";
import { EndpointQueues } from "./queues";
import { SongWorker, type SongWorkerContext } from "./song-worker";

const AUDIO_POLL_INTERVAL = 2_000; // 2 seconds (ACE needs frequent polling)
const HEARTBEAT_STALE_MS = 90_000; // 90 seconds = 3 missed 30s heartbeats

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

// ─── Persona scan state ─────────────────────────────────────────────

const personaPending = new Set<string>();
let lastPersonaScanAt = 0;
const PERSONA_SCAN_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let forcePersonaScan = false;

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
	return {
		textProvider: all.textProvider || "ollama",
		textModel: all.textModel || "",
		imageProvider: all.imageProvider || "comfyui",
		imageModel: all.imageModel ?? undefined,
		personaProvider: all.personaProvider || "",
		personaModel: all.personaModel || "",
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
	if (songWorkers.has(song._id)) return; // Already tracked

	const playlistId = playlist._id;
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
	};

	const worker = new SongWorker(song, ctx);
	songWorkers.set(song._id, worker);

	// Track song → playlist for reverse lookup
	let songSet = playlistSongs.get(playlistId);
	if (!songSet) {
		songSet = new Set();
		playlistSongs.set(playlistId, songSet);
	}
	songSet.add(song._id);

	// Fire-and-forget
	worker.run().finally(() => {
		songWorkers.delete(song._id);
		const set = playlistSongs.get(playlistId);
		if (set) {
			set.delete(song._id);
			if (set.size === 0) playlistSongs.delete(playlistId);
		}
	});
}

function cancelPlaylistWorkers(playlistId: string): void {
	const songIds = playlistSongs.get(playlistId);
	if (songIds) {
		for (const songId of songIds) {
			const worker = songWorkers.get(songId);
			if (worker) worker.cancel();
		}
	}
	playlistSongs.delete(playlistId);
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
				console.log(
					`[worker] Playlist ${playlistId} stale (no heartbeat for ${Math.round(HEARTBEAT_STALE_MS / 1000)}s), setting to closing`,
				);
				await playlistService.updateStatus(playlistId, "closing");
			}
		} catch (err) {
			console.error(
				`[worker] Heartbeat timeout error for ${playlistId}:`,
				err instanceof Error ? err.message : err,
			);
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
				console.log(
					`  [buffer] Created pending song at order ${orderIndex} (deficit: ${workQueue.bufferDeficit}, epoch: ${playlist.promptEpoch ?? 0})`,
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
			console.log(
				`[worker] Oneshot playlist ${playlistId} complete, setting to closing`,
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

	// Resolve persona provider + model
	const explicitPersonaProvider = settings.personaProvider || "";
	const explicitPersonaModel =
		settings.personaModel && settings.personaModel !== "__fallback__"
			? settings.personaModel
			: "";
	let pProvider: "ollama" | "openrouter";
	let pModel: string;
	if (explicitPersonaModel) {
		pProvider = (explicitPersonaProvider || "ollama") as
			| "ollama"
			| "openrouter";
		pModel = explicitPersonaModel;
	} else if (
		!explicitPersonaProvider ||
		explicitPersonaProvider === settings.textProvider
	) {
		pProvider = (settings.textProvider || "ollama") as "ollama" | "openrouter";
		pModel = settings.textModel;
	} else {
		console.log(
			`[persona] Skipping scan: personaProvider is "${explicitPersonaProvider}" but no personaModel set (textProvider is "${settings.textProvider}")`,
		);
		return;
	}
	if (!pModel) return;

	for (const song of needsPersona) {
		if (personaPending.has(song._id)) continue;
		personaPending.add(song._id);
		console.log(`[persona] Queuing "${song.title}" (${song._id})`);

		queues.llm
			.enqueue({
				songId: song._id,
				priority: PERSONA_PRIORITY,
				endpoint: pProvider,
				execute: async (signal) => {
					return await generatePersonaExtract({
						song: {
							title: song.title,
							artistName: song.artistName ?? "",
							genre: song.genre ?? "",
							subGenre: song.subGenre ?? "",
							mood: song.mood ?? undefined,
							energy: song.energy ?? undefined,
							era: song.era ?? undefined,
							vocalStyle: song.vocalStyle ?? undefined,
							instruments: song.instruments,
							themes: song.themes,
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
				await songService.updatePersonaExtract(song._id, result as string);
				console.log(`[persona] Done "${song.title}" (${processingMs}ms)`);
			})
			.catch((err) => {
				console.error(
					`[persona] Failed "${song.title}":`,
					err instanceof Error ? err.message : err,
				);
			})
			.finally(() => {
				personaPending.delete(song._id);
			});
	}

	lastPersonaScanAt = Date.now();
}

export function triggerPersonaScan() {
	forcePersonaScan = true;
	// Schedule a persona scan immediately
	getSettings()
		.then((settings) => runPersonaScan(settings))
		.catch((err) =>
			console.error(
				"[persona] Triggered scan error:",
				err instanceof Error ? err.message : err,
			),
		);
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
		(p) => p._id === data.playlistId,
	);
	if (!playlistWire) return;

	console.log(
		`[event] Spawning SongWorker for ${data.songId} (${data.status})`,
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
				.catch((err) =>
					console.error(
						"[persona] Scan error:",
						err instanceof Error ? err.message : err,
					),
				);
		}
	}

	// Song entered retry_pending → auto-retry
	if (to === "retry_pending") {
		try {
			await songService.retryErrored(songId);
			console.log(`[event] Auto-retried song ${songId}`);
		} catch (err) {
			console.error(
				`[event] Failed to retry song ${songId}:`,
				err instanceof Error ? err.message : err,
			);
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
			(p) => p._id === playlistId,
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
				console.log(
					`[worker] Playlist ${playlistId} closing complete, setting to closed`,
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

	console.log(
		`[epoch] Epoch changed ${lastSeenEpoch} → ${newEpoch} for playlist ${playlistId}`,
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
		const w = songWorkers.get(song._id);
		if (w) w.cancel();
		await songService.deleteSong(song._id);
		console.log(
			`  [epoch-cleanup] Deleted old-epoch pending song ${song._id} (epoch ${song.promptEpoch ?? 0} < ${newEpoch})`,
		);
	}

	// Recalculate priorities for remaining queued songs
	const allSongs = [
		...workQueue.pending,
		...workQueue.metadataReady,
		...workQueue.generatingAudio,
		...workQueue.needsRecovery,
	];
	const songMap = new Map(allSongs.map((s) => [s._id, s]));

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
			console.log(
				`[worker] Playlist ${playlistId} closing immediately (no transient work)`,
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

	if (to === "active" && from === "closing") {
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
	} catch (err) {
		console.error(
			"[worker] Failed to refresh settings:",
			err instanceof Error ? err.message : err,
		);
	}
}

// ─── Stale song cleanup (periodic) ─────────────────────────────────

async function staleSongCleanup(): Promise<void> {
	try {
		const activePlaylists = await playlistService.listActive();
		for (const playlist of activePlaylists) {
			const workQueue = await songService.getWorkQueue(playlist._id);
			if (workQueue.staleSongs.length > 0) {
				for (const stale of workQueue.staleSongs) {
					console.log(
						`  [stale] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`,
					);
					const w = songWorkers.get(stale._id);
					if (w) w.cancel();
					await songService.deleteSong(stale._id);
				}
			}
		}
	} catch (err) {
		console.error(
			"[worker] Stale cleanup error:",
			err instanceof Error ? err.message : err,
		);
	}
}

// ─── Startup ACE reconciliation ─────────────────────────────────────

async function reconcileAceState() {
	const songs = await songService.getInAudioPipeline();
	if (songs.length === 0) return;

	console.log(
		`[startup] Reconciling ${songs.length} song(s) in audio pipeline...`,
	);

	const taskIds = songs.filter((s) => s.aceTaskId).map((s) => s.aceTaskId!);

	if (taskIds.length > 0) {
		let aceStatus: Map<string, { status: string; audioPath?: string }>;
		try {
			aceStatus = await batchPollAce(taskIds);
		} catch (_error: unknown) {
			console.log(
				`[startup] ACE unreachable, reverting all ${songs.length} songs to metadata_ready`,
			);
			for (const song of songs) {
				await songService.revertTransient(song._id);
			}
			return;
		}

		for (const song of songs) {
			if (!song.aceTaskId) {
				await songService.revertTransient(song._id);
				console.log(`[startup] Reverted ${song._id} — no ACE task ID`);
				continue;
			}
			const status = aceStatus.get(song.aceTaskId);
			if (
				!status ||
				status.status === "not_found" ||
				status.status === "failed"
			) {
				await songService.revertTransient(song._id);
				console.log(
					`[startup] Reverted ${song._id} — ACE task ${song.aceTaskId} is gone`,
				);
			} else if (status.status === "succeeded" && status.audioPath) {
				console.log(
					`[startup] ACE task ${song.aceTaskId} already done — SongWorker will save`,
				);
			} else {
				console.log(
					`[startup] ACE task ${song.aceTaskId} still running — will resume`,
				);
			}
		}
	} else {
		for (const song of songs) {
			await songService.revertTransient(song._id);
			console.log(`[startup] Reverted ${song._id} — no ACE task ID`);
		}
	}
}

/** Startup sweep: spawn workers for all actionable songs across active playlists */
async function startupSweep() {
	const activePlaylists = await playlistService.listActive();
	console.log(`[startup] ${activePlaylists.length} active/closing playlist(s)`);

	for (const playlist of activePlaylists) {
		playlistEpochs.set(playlist._id, playlist.promptEpoch ?? 0);

		// Start heartbeat timer for active playlists
		if (playlist.status === "active") {
			resetHeartbeatTimer(playlist._id);
		}

		const workQueue = await songService.getWorkQueue(playlist._id);
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
				console.log(
					`  [startup] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`,
				);
				const w = songWorkers.get(stale._id);
				if (w) w.cancel();
				await songService.deleteSong(stale._id);
			}
		}

		// Process retries
		for (const song of workQueue.retryPending) {
			console.log(
				`  [startup] Retrying song ${song._id} (retry ${(song.retryCount || 0) + 1}/3)`,
			);
			await songService.retryErrored(song._id);
		}

		// Check buffer deficit for active playlists
		if (playlist.status === "active") {
			await checkBufferDeficit(playlist._id);
		}

		// Closing check
		if (playlist.status === "closing" && workQueue.transientCount === 0) {
			console.log(
				`[startup] Playlist ${playlist._id} closing complete, setting to closed`,
			);
			await playlistService.updateStatus(playlist._id, "closed");
		}
	}
}

// ─── Startup ─────────────────────────────────────────────────────────

export async function startWorker(): Promise<void> {
	console.log("[worker] Starting event-driven song generation worker...");

	// Initialize endpoint queues
	queues = new EndpointQueues((taskId, signal) => pollAce(taskId, signal));

	// Refresh queue concurrency from settings
	try {
		const settings = await getSettings();
		queues.refreshAll(settings);
	} catch (err) {
		console.warn(
			"[worker] Could not load initial settings, using defaults:",
			err instanceof Error ? err.message : err,
		);
	}

	// Reconcile any songs stuck in audio pipeline against ACE's actual state
	await reconcileAceState();

	// Register event handlers
	on("song.created", handleSongCreated);
	on("song.status_changed", handleSongStatusChanged);
	on("playlist.created", handlePlaylistCreated);
	on("playlist.steered", handlePlaylistSteered);
	on("playlist.heartbeat", handlePlaylistHeartbeat);
	on("playlist.deleted", handlePlaylistDeleted);
	on("playlist.status_changed", handlePlaylistStatusChanged);
	on("settings.changed", handleSettingsChanged);

	// Audio poll timer — ACE needs frequent polling for status checks
	setInterval(async () => {
		try {
			await queues.audio.tickPolls();
		} catch (err) {
			console.error(
				"[worker] Audio poll error:",
				err instanceof Error ? err.message : err,
			);
		}
	}, AUDIO_POLL_INTERVAL);

	// Stale song cleanup — periodic safety net (every 5 minutes)
	setInterval(staleSongCleanup, 5 * 60 * 1000);

	// Run startup sweep to catch up on any pending work
	await startupSweep();

	console.log("[worker] Worker started, listening on event bus");
}

/** Expose queues for status API */
export function getQueues(): EndpointQueues {
	return queues;
}

/** Expose worker counts for status API */
export function getWorkerStats() {
	return {
		songWorkerCount: songWorkers.size,
		trackedPlaylists: [...playlistEpochs.keys()],
	};
}

/** @internal — exported for unit tests only */
export const _test = {
	handleSongCreated,
	handleSongStatusChanged,
	handlePlaylistCreated,
	handlePlaylistSteered,
	handlePlaylistHeartbeat,
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
		songWorkers.clear();
		playlistSongs.clear();
		playlistEpochs.clear();
		for (const t of heartbeatTimers.values()) clearTimeout(t);
		heartbeatTimers.clear();
		bufferLocks.clear();
		personaPending.clear();
		lastPersonaScanAt = 0;
		forcePersonaScan = false;
	},
};
