import { apiClient } from "./api-client"
import type { Song, Playlist } from "../api-server/types"
import { pollAce, batchPollAce } from "../src/services/ace"
import { EndpointQueues } from "./queues"
import { SongWorker } from "./song-worker"
import { startHttpServer } from "./http-server"
import type { RecentSong } from "../src/services/llm"
import { generatePersonaExtract } from "../src/services/llm"
import { calculatePriority, PERSONA_PRIORITY } from "./priority"
import { connectWorkerRabbit, type WorkMessage } from "./rabbit"

const MAINTENANCE_INTERVAL = 10_000 // 10 seconds
const AUDIO_POLL_INTERVAL = 2_000 // 2 seconds (ACE needs frequent polling)
const HEARTBEAT_STALE_MS = 90_000 // 90 seconds = 3 missed 30s heartbeats

// ─── State ───────────────────────────────────────────────────────────

/** Active song workers keyed by songId */
const songWorkers = new Map<string, SongWorker>()

/** Reverse index: playlist → set of active song IDs */
const playlistSongs = new Map<string, Set<string>>()

/** Tracked playlist IDs from last tick */
const trackedPlaylists = new Set<string>()

/** Last-seen promptEpoch per playlist, for detecting epoch changes */
const playlistEpochs = new Map<string, number>()

let queues: EndpointQueues

// ─── Persona scan state ─────────────────────────────────────────────

const personaPending = new Set<string>()
let lastPersonaScanAt = 0
const PERSONA_SCAN_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
let forcePersonaScan = false

// ─── Helpers ─────────────────────────────────────────────────────────

async function getSettings(): Promise<{ textProvider: string; textModel: string; imageProvider: string; imageModel?: string; personaProvider: string; personaModel: string }> {
	const settings = await apiClient.getSettings()
	return {
		textProvider: settings.textProvider || "ollama",
		textModel: settings.textModel || "",
		imageProvider: settings.imageProvider || "comfyui",
		imageModel: settings.imageModel ?? undefined,
		personaProvider: settings.personaProvider || "",
		personaModel: settings.personaModel || "",
	}
}

/** Convert null fields to undefined for service function compatibility */
function toRecentSongs(items: Array<{ title: string; artistName: string; genre: string; subGenre: string; vocalStyle: string | null; mood: string | null; energy: string | null }>): RecentSong[] {
	return items.map((s) => ({
		title: s.title,
		artistName: s.artistName,
		genre: s.genre,
		subGenre: s.subGenre,
		vocalStyle: s.vocalStyle ?? undefined,
		mood: s.mood ?? undefined,
		energy: s.energy ?? undefined,
	}))
}

/** Create a SongWorker for a song and register it */
function spawnSongWorker(
	song: Song,
	playlist: Playlist,
	workQueue: { recentCompleted: Array<{ title: string; artistName: string; genre: string; subGenre: string; vocalStyle: string | null; mood: string | null; energy: string | null }>; recentDescriptions: string[] },
): void {
	if (songWorkers.has(song._id)) return // Already tracked

	const playlistId = playlist._id
	const worker = new SongWorker(song, {
		apiClient,
		queues,
		playlist,
		recentSongs: toRecentSongs(workQueue.recentCompleted),
		recentDescriptions: workQueue.recentDescriptions,
		getPlaylistActive: async () => {
			const pl = await apiClient.getPlaylist(playlistId)
			return pl?.status === "active"
		},
		getCurrentEpoch: () => playlistEpochs.get(playlistId) ?? 0,
		getSettings,
	})
	songWorkers.set(song._id, worker)

	// Track song → playlist for reverse lookup
	let songSet = playlistSongs.get(playlistId)
	if (!songSet) {
		songSet = new Set()
		playlistSongs.set(playlistId, songSet)
	}
	songSet.add(song._id)

	// Fire-and-forget
	worker.run().finally(() => {
		songWorkers.delete(song._id)
		const set = playlistSongs.get(playlistId)
		if (set) {
			set.delete(song._id)
			if (set.size === 0) playlistSongs.delete(playlistId)
		}
	})
}

// ─── Persona scan ───────────────────────────────────────────────────

async function runPersonaScan(settings: Awaited<ReturnType<typeof getSettings>>) {
	const needsPersona = await apiClient.getNeedsPersona()
	if (needsPersona.length === 0) return

	// Resolve persona provider + model
	const explicitPersonaProvider = settings.personaProvider || ""
	const explicitPersonaModel = settings.personaModel && settings.personaModel !== "__fallback__" ? settings.personaModel : ""
	let pProvider: "ollama" | "openrouter"
	let pModel: string
	if (explicitPersonaModel) {
		pProvider = (explicitPersonaProvider || "ollama") as "ollama" | "openrouter"
		pModel = explicitPersonaModel
	} else if (!explicitPersonaProvider || explicitPersonaProvider === settings.textProvider) {
		pProvider = (settings.textProvider || "ollama") as "ollama" | "openrouter"
		pModel = settings.textModel
	} else {
		console.log(`[persona] Skipping scan: personaProvider is "${explicitPersonaProvider}" but no personaModel set (textProvider is "${settings.textProvider}")`)
		return
	}
	if (!pModel) return

	for (const song of needsPersona) {
		if (personaPending.has(song._id)) continue
		personaPending.add(song._id)
		console.log(`[persona] Queuing "${song.title}" (${song._id})`)

		queues.llm.enqueue({
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
				})
			},
		}).then(async ({ result, processingMs }) => {
			await apiClient.updatePersonaExtract(song._id, result as string)
			console.log(`[persona] Done "${song.title}" (${processingMs}ms)`)
		}).catch((err) => {
			console.error(`[persona] Failed "${song.title}":`, err instanceof Error ? err.message : err)
		}).finally(() => {
			personaPending.delete(song._id)
		})
	}

	lastPersonaScanAt = Date.now()
}

export function triggerPersonaScan() {
	forcePersonaScan = true
	console.log("[persona] Manual scan triggered, will run next maintenance tick")
}

// ─── RabbitMQ message handlers ──────────────────────────────────────

async function handleMetadataWork(msg: WorkMessage): Promise<void> {
	const { songId, playlistId } = msg
	if (songWorkers.has(songId)) return // Already processing

	const song = await apiClient.getSong(songId)
	if (!song || (song.status !== "pending" && song.status !== "generating_metadata")) return

	const playlist = await apiClient.getPlaylist(playlistId)
	if (!playlist) return

	const workQueue = await apiClient.getWorkQueue(playlistId)

	console.log(`[rabbit] Starting SongWorker for metadata: ${songId}`)
	spawnSongWorker(song, playlist, workQueue)
}

async function handleAudioWork(msg: WorkMessage): Promise<void> {
	const { songId, playlistId } = msg
	if (songWorkers.has(songId)) return // Already processing

	const song = await apiClient.getSong(songId)
	if (!song || song.status !== "metadata_ready") return

	const playlist = await apiClient.getPlaylist(playlistId)
	if (!playlist) return

	const workQueue = await apiClient.getWorkQueue(playlistId)

	console.log(`[rabbit] Starting SongWorker for audio: ${songId}`)
	spawnSongWorker(song, playlist, workQueue)
}

async function handleRetryWork(msg: WorkMessage): Promise<void> {
	const { songId } = msg
	try {
		await apiClient.retrySong(songId)
		console.log(`[rabbit] Retried song ${songId}`)
	} catch (err) {
		console.error(`[rabbit] Failed to retry song ${songId}:`, err instanceof Error ? err.message : err)
	}
}

// ─── Maintenance tick ───────────────────────────────────────────────

async function maintenanceTick() {
	try {
		// 1. Fetch active + closing playlists
		const workerPlaylists = await apiClient.getWorkerPlaylists()
		const workerPlaylistIds = new Set(workerPlaylists.map((p) => p._id))

		// 2. Fetch settings, refresh queue concurrency
		const settings = await getSettings()
		queues.refreshAll(settings)

		// 3. Check heartbeats — flag stale playlists as closing
		for (const playlist of workerPlaylists) {
			if (playlist.status === "active" && playlist.lastSeenAt) {
				const elapsed = Date.now() - playlist.lastSeenAt
				if (elapsed > HEARTBEAT_STALE_MS) {
					console.log(`[worker] Playlist ${playlist._id} stale (no heartbeat for ${Math.round(elapsed / 1000)}s), setting to closing`)
					await apiClient.updatePlaylistStatus(playlist._id, "closing")
				}
			}
		}

		// 4. Cleanup disappeared playlists
		for (const playlistId of trackedPlaylists) {
			if (!workerPlaylistIds.has(playlistId)) {
				console.log(`[worker] Playlist ${playlistId} gone, cancelling workers`)
				cancelPlaylistWorkers(playlistId)
				trackedPlaylists.delete(playlistId)
				playlistEpochs.delete(playlistId)
			}
		}

		// 5. Process each playlist for maintenance tasks
		for (const playlist of workerPlaylists) {
			trackedPlaylists.add(playlist._id)
			const playlistId = playlist._id
			const isClosing = playlist.status === "closing"
			const isOneshot = playlist.mode === "oneshot"

			// Track epoch changes
			const currentEpoch = playlist.promptEpoch ?? 0
			const lastSeenEpoch = playlistEpochs.get(playlistId) ?? currentEpoch
			playlistEpochs.set(playlistId, currentEpoch)
			const epochChanged = currentEpoch > lastSeenEpoch

			try {
				const workQueue = await apiClient.getWorkQueue(playlistId)

				// === Epoch change: recalculate priorities ===
				if (epochChanged) {
					console.log(`[epoch] Epoch changed ${lastSeenEpoch} → ${currentEpoch} for playlist ${playlistId}`)
					const allSongs = [
						...workQueue.pending,
						...workQueue.metadataReady,
						...workQueue.generatingAudio,
						...workQueue.needsRecovery,
					]
					const songMap = new Map(allSongs.map((s) => [s._id, s]))

					queues.recalcPendingPriorities((songId) => {
						const song = songMap.get(songId)
						if (!song) return undefined
						return calculatePriority({
							isOneshot,
							isInterrupt: !!song.interruptPrompt,
							orderIndex: song.orderIndex,
							currentOrderIndex: playlist.currentOrderIndex ?? 0,
							isClosing,
							currentEpoch,
							songEpoch: song.promptEpoch ?? 0,
						})
					})
				}

				// === Active playlists: buffer management + retry ===
				if (!isClosing) {
					const shouldCreateSong = isOneshot
						? workQueue.totalSongs === 0
						: workQueue.bufferDeficit > 0
					if (shouldCreateSong) {
						const orderIndex = Math.ceil(workQueue.maxOrderIndex) + 1
						await apiClient.createPending({
							playlistId,
							orderIndex,
							promptEpoch: playlist.promptEpoch ?? 0,
						})
						console.log(`  [queue-keeper] Created pending song at order ${orderIndex} (deficit: ${workQueue.bufferDeficit}, epoch: ${playlist.promptEpoch ?? 0})`)
					}

					// Retry: revert retry_pending songs
					if (workQueue.retryPending.length > 0) {
						for (const song of workQueue.retryPending) {
							console.log(`  [retry] Reverting song ${song._id} (retry ${(song.retryCount || 0) + 1}/3)`)
							await apiClient.retrySong(song._id)
						}
					}
				}

				// === Epoch cleanup: delete old-epoch pending songs ===
				const deletedSongIds = new Set<string>()
				if (!isClosing) {
					const oldPending = workQueue.pending.filter(
						(s) => (s.promptEpoch ?? 0) < currentEpoch && !s.isInterrupt,
					)
					for (const song of oldPending) {
						const w = songWorkers.get(song._id)
						if (w) w.cancel()
						await apiClient.deleteSong(song._id)
						deletedSongIds.add(song._id)
						console.log(`  [epoch-cleanup] Deleted old-epoch pending song ${song._id} (epoch ${song.promptEpoch ?? 0} < ${currentEpoch})`)
					}
				}

				// === Safety net: spawn SongWorkers for orphaned actionable songs ===
				// (In case RabbitMQ message was missed or worker restarted)
				const actionableSongs = [
					...workQueue.pending,
					...workQueue.metadataReady,
					...workQueue.generatingAudio,
					...workQueue.needsRecovery,
				]
					.filter((s) => !deletedSongIds.has(s._id))
					.sort((a, b) => {
						const aEpoch = (a.promptEpoch ?? 0) === currentEpoch ? 0 : 1
						const bEpoch = (b.promptEpoch ?? 0) === currentEpoch ? 0 : 1
						return aEpoch - bEpoch
					})

				for (const song of actionableSongs) {
					spawnSongWorker(song, playlist, workQueue)
				}

				// === Stale song cleanup ===
				if (workQueue.staleSongs.length > 0) {
					for (const stale of workQueue.staleSongs) {
						console.log(`  [stale] Removing stuck song "${stale.title || stale._id}" (status: ${stale.status})`)
						const w = songWorkers.get(stale._id)
						if (w) w.cancel()
						await apiClient.deleteSong(stale._id)
					}
				}

				// === Oneshot auto-close ===
				if (isOneshot && !isClosing && workQueue.transientCount === 0 && workQueue.totalSongs > 0) {
					console.log(`[worker] Oneshot playlist ${playlistId} complete, setting to closing`)
					await apiClient.updatePlaylistStatus(playlistId, "closing")
				}

				// === Closing playlists: check if all work is done ===
				if (isClosing && workQueue.transientCount === 0) {
					console.log(`[worker] Playlist ${playlistId} closing complete, setting to closed`)
					await apiClient.updatePlaylistStatus(playlistId, "closed")
					cancelPlaylistWorkers(playlistId)
					trackedPlaylists.delete(playlistId)
					playlistEpochs.delete(playlistId)
				}
			} catch (error: unknown) {
				console.error(`[worker] Error processing playlist ${playlistId}:`, error instanceof Error ? error.message : error)
			}
		}

		// 6. Persona scan — daily or on manual trigger
		const now = Date.now()
		if (forcePersonaScan || (now - lastPersonaScanAt > PERSONA_SCAN_INTERVAL)) {
			forcePersonaScan = false
			try {
				await runPersonaScan(settings)
			} catch (err) {
				console.error("[persona] Scan error:", err instanceof Error ? err.message : err)
			}
		}
	} catch (error: unknown) {
		console.error("[worker] Maintenance tick error:", error instanceof Error ? error.message : error)
	}
}

function cancelPlaylistWorkers(playlistId: string): void {
	const songIds = playlistSongs.get(playlistId)
	if (songIds) {
		for (const songId of songIds) {
			const worker = songWorkers.get(songId)
			if (worker) worker.cancel()
		}
	}
	playlistSongs.delete(playlistId)
}

// ─── Startup ACE reconciliation ─────────────────────────────────────

async function reconcileAceState() {
	const songs = await apiClient.getInAudioPipeline()
	if (songs.length === 0) return

	console.log(`[startup] Reconciling ${songs.length} song(s) in audio pipeline...`)

	const taskIds = songs.filter(s => s.aceTaskId).map(s => s.aceTaskId!)

	if (taskIds.length > 0) {
		let aceStatus: Map<string, { status: string; audioPath?: string }>
		try {
			aceStatus = await batchPollAce(taskIds)
		} catch (_error: unknown) {
			console.log(`[startup] ACE unreachable, reverting all ${songs.length} songs to metadata_ready`)
			for (const song of songs) {
				await apiClient.revertToMetadataReady(song._id)
			}
			return
		}

		for (const song of songs) {
			if (!song.aceTaskId) {
				await apiClient.revertToMetadataReady(song._id)
				console.log(`[startup] Reverted ${song._id} — no ACE task ID`)
				continue
			}
			const status = aceStatus.get(song.aceTaskId)
			if (!status || status.status === "not_found" || status.status === "failed") {
				await apiClient.revertToMetadataReady(song._id)
				console.log(`[startup] Reverted ${song._id} — ACE task ${song.aceTaskId} is gone`)
			} else if (status.status === "succeeded" && status.audioPath) {
				console.log(`[startup] ACE task ${song.aceTaskId} already done — SongWorker will save`)
			} else {
				console.log(`[startup] ACE task ${song.aceTaskId} still running — will resume`)
			}
		}
	} else {
		for (const song of songs) {
			await apiClient.revertToMetadataReady(song._id)
			console.log(`[startup] Reverted ${song._id} — no ACE task ID`)
		}
	}
}

// ─── Startup ─────────────────────────────────────────────────────────

async function main() {
	console.log("[worker] Starting song generation worker...")

	// Verify API server connection
	try {
		const playlists = await apiClient.getWorkerPlaylists()
		console.log(`[worker] Connected to API server. ${playlists.length} worker playlist(s)`)
	} catch (error: unknown) {
		console.error("[worker] Failed to connect to API server:", error instanceof Error ? error.message : error)
		process.exit(1)
	}

	// Initialize endpoint queues
	queues = new EndpointQueues(
		(taskId, signal) => pollAce(taskId, signal),
	)

	// Reconcile any songs stuck in audio pipeline against ACE's actual state
	await reconcileAceState()

	// Connect to RabbitMQ and start consuming work queues
	await connectWorkerRabbit({
		onMetadata: handleMetadataWork,
		onAudio: handleAudioWork,
		onRetry: handleRetryWork,
	})

	// Start HTTP server for queue status API
	const port = Number(process.env.WORKER_API_PORT) || 3099
	const startTime = Date.now()
	startHttpServer({
		queues,
		getSongWorkerCount: () => songWorkers.size,
		getPlaylistInfo: () => {
			return [...trackedPlaylists].map((id) => ({
				id,
				name: id,
				activeSongWorkers: 0,
			}))
		},
		startTime,
		onTriggerPersonaScan: triggerPersonaScan,
	}, port)

	console.log("[worker] Worker started, consuming RabbitMQ work queues")

	// Audio poll timer — needs frequent ticking for ACE status checks
	setInterval(async () => {
		try {
			await queues.audio.tickPolls()
		} catch (err) {
			console.error("[worker] Audio poll error:", err instanceof Error ? err.message : err)
		}
	}, AUDIO_POLL_INTERVAL)

	// Maintenance timer — handles buffer management, stale cleanup, epoch, closing, persona
	setInterval(maintenanceTick, MAINTENANCE_INTERVAL)

	// Run first maintenance tick immediately to catch up on any pending work
	await maintenanceTick()
}

main().catch((error) => {
	console.error("[worker] Fatal error:", error)
	process.exit(1)
})
