import type {
	Song,
	Playlist,
	WorkQueue,
	NeedsPersonaSong,
} from "./types"

/**
 * Typed HTTP client for the Infinitune API server.
 * Used by worker, room server, and server-side code.
 */
export class InfinituneApiClient {
	private baseUrl: string

	constructor(baseUrl?: string) {
		this.baseUrl = baseUrl ?? process.env.API_URL ?? "http://localhost:5175"
	}

	private async get<T>(path: string): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`)
		if (!res.ok)
			throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
		return res.json() as Promise<T>
	}

	private async post<T>(path: string, body?: unknown): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		})
		if (!res.ok)
			throw new Error(
				`POST ${path} failed: ${res.status} ${res.statusText}`,
			)
		return res.json() as Promise<T>
	}

	private async patch<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		if (!res.ok)
			throw new Error(
				`PATCH ${path} failed: ${res.status} ${res.statusText}`,
			)
		return res.json() as Promise<T>
	}

	private async delete<T>(path: string): Promise<T> {
		const res = await fetch(`${this.baseUrl}${path}`, { method: "DELETE" })
		if (!res.ok)
			throw new Error(
				`DELETE ${path} failed: ${res.status} ${res.statusText}`,
			)
		return res.json() as Promise<T>
	}

	// ─── Settings ─────────────────────────────────────────────────────

	getSettings(): Promise<Record<string, string>> {
		return this.get("/api/settings")
	}

	getSetting(key: string): Promise<string | null> {
		return this.get(`/api/settings/${encodeURIComponent(key)}`)
	}

	setSetting(key: string, value: string): Promise<{ ok: true }> {
		return this.post("/api/settings", { key, value })
	}

	// ─── Playlists ────────────────────────────────────────────────────

	listPlaylists(): Promise<Playlist[]> {
		return this.get("/api/playlists")
	}

	getPlaylist(id: string): Promise<Playlist | null> {
		return this.get(`/api/playlists/${id}`)
	}

	getCurrentPlaylist(): Promise<Playlist | null> {
		return this.get("/api/playlists/current")
	}

	getClosedPlaylists(): Promise<Playlist[]> {
		return this.get("/api/playlists/closed")
	}

	getWorkerPlaylists(): Promise<Playlist[]> {
		return this.get("/api/playlists/worker")
	}

	getPlaylistByKey(key: string): Promise<Playlist | null> {
		return this.get(`/api/playlists/by-key/${encodeURIComponent(key)}`)
	}

	createPlaylist(data: {
		name: string
		prompt: string
		llmProvider: string
		llmModel: string
		mode?: string
		playlistKey?: string
		lyricsLanguage?: string
		targetBpm?: number
		targetKey?: string
		timeSignature?: string
		audioDuration?: number
		inferenceSteps?: number
		lmTemperature?: number
		lmCfgScale?: number
		inferMethod?: string
	}): Promise<Playlist> {
		return this.post("/api/playlists", data)
	}

	updatePlaylistParams(
		id: string,
		params: Record<string, unknown>,
	): Promise<{ ok: true }> {
		return this.patch(`/api/playlists/${id}/params`, params)
	}

	updatePlaylistStatus(
		id: string,
		status: string,
	): Promise<{ ok: true }> {
		return this.patch(`/api/playlists/${id}/status`, { status })
	}

	updatePlaylistPosition(
		id: string,
		currentOrderIndex: number,
	): Promise<{ ok: true }> {
		return this.patch(`/api/playlists/${id}/position`, {
			currentOrderIndex,
		})
	}

	incrementSongsGenerated(id: string): Promise<{ ok: true }> {
		return this.post(`/api/playlists/${id}/increment-generated`)
	}

	resetPlaylistDefaults(id: string): Promise<{ ok: true }> {
		return this.post(`/api/playlists/${id}/reset-defaults`)
	}

	updatePlaylistPrompt(
		id: string,
		prompt: string,
	): Promise<{ ok: true }> {
		return this.patch(`/api/playlists/${id}/prompt`, { prompt })
	}

	deletePlaylist(id: string): Promise<{ ok: true }> {
		return this.delete(`/api/playlists/${id}`)
	}

	playlistHeartbeat(id: string): Promise<{ ok: true }> {
		return this.post(`/api/playlists/${id}/heartbeat`)
	}

	// ─── Songs ────────────────────────────────────────────────────────

	listAllSongs(): Promise<Song[]> {
		return this.get("/api/songs")
	}

	getSong(id: string): Promise<Song | null> {
		return this.get(`/api/songs/${id}`)
	}

	getSongsByPlaylist(playlistId: string): Promise<Song[]> {
		return this.get(`/api/songs/by-playlist/${playlistId}`)
	}

	getSongQueue(playlistId: string): Promise<Song[]> {
		return this.get(`/api/songs/queue/${playlistId}`)
	}

	getNextOrderIndex(playlistId: string): Promise<number> {
		return this.get(`/api/songs/next-order-index/${playlistId}`)
	}

	getInAudioPipeline(): Promise<Song[]> {
		return this.get("/api/songs/in-audio-pipeline")
	}

	getNeedsPersona(): Promise<NeedsPersonaSong[]> {
		return this.get("/api/songs/needs-persona")
	}

	getWorkQueue(playlistId: string): Promise<WorkQueue> {
		return this.get(`/api/songs/work-queue/${playlistId}`)
	}

	getBatch(ids: string[]): Promise<Song[]> {
		return this.post("/api/songs/batch", { ids })
	}

	createSong(data: {
		playlistId: string
		orderIndex: number
		title: string
		artistName: string
		genre: string
		subGenre: string
		lyrics: string
		caption: string
		coverPrompt?: string
		bpm: number
		keyScale: string
		timeSignature: string
		audioDuration: number
		vocalStyle?: string
		mood?: string
		energy?: string
		era?: string
		instruments?: string[]
		tags?: string[]
		themes?: string[]
		language?: string
		description?: string
		isInterrupt?: boolean
		interruptPrompt?: string
	}): Promise<Song> {
		return this.post("/api/songs", data)
	}

	createPending(data: {
		playlistId: string
		orderIndex: number
		isInterrupt?: boolean
		interruptPrompt?: string
		promptEpoch?: number
	}): Promise<Song> {
		return this.post("/api/songs/create-pending", data)
	}

	createMetadataReady(data: {
		playlistId: string
		orderIndex: number
		promptEpoch?: number
		title: string
		artistName: string
		genre: string
		subGenre: string
		lyrics: string
		caption: string
		coverPrompt?: string
		bpm: number
		keyScale: string
		timeSignature: string
		audioDuration: number
		vocalStyle?: string
		mood?: string
		energy?: string
		era?: string
		instruments?: string[]
		tags?: string[]
		themes?: string[]
		language?: string
		description?: string
	}): Promise<Song> {
		return this.post("/api/songs/create-metadata-ready", data)
	}

	updateMetadata(
		id: string,
		metadata: Record<string, unknown>,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/metadata`, metadata)
	}

	updateStatus(
		id: string,
		status: string,
		errorMessage?: string,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/status`, { status, errorMessage })
	}

	claimForMetadata(id: string): Promise<boolean> {
		return this.post(`/api/songs/${id}/claim-metadata`)
	}

	claimForAudio(id: string): Promise<boolean> {
		return this.post(`/api/songs/${id}/claim-audio`)
	}

	completeMetadata(
		id: string,
		metadata: {
			title: string
			artistName: string
			genre: string
			subGenre: string
			lyrics: string
			caption: string
			coverPrompt?: string
			bpm: number
			keyScale: string
			timeSignature: string
			audioDuration: number
			vocalStyle?: string
			mood?: string
			energy?: string
			era?: string
			instruments?: string[]
			tags?: string[]
			themes?: string[]
			language?: string
			description?: string
			llmProvider?: string
			llmModel?: string
			metadataProcessingMs?: number
		},
	): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/complete-metadata`, metadata)
	}

	updateAceTask(
		id: string,
		aceTaskId: string,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/ace-task`, { aceTaskId })
	}

	markReady(
		id: string,
		data: { audioUrl: string; audioProcessingMs?: number },
	): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/mark-ready`, data)
	}

	markError(
		id: string,
		data: { errorMessage: string; erroredAtStatus?: string },
	): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/mark-error`, data)
	}

	updateCover(id: string, coverUrl: string): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/cover`, { coverUrl })
	}

	uploadCover(
		id: string,
		imageBase64: string,
	): Promise<{ ok: true; coverUrl: string }> {
		return this.post(`/api/songs/${id}/upload-cover`, { imageBase64 })
	}

	updateCoverProcessingMs(
		id: string,
		coverProcessingMs: number,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/cover-processing-ms`, {
			coverProcessingMs,
		})
	}

	updateAudioDuration(
		id: string,
		audioDuration: number,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/audio-duration`, { audioDuration })
	}

	updateStoragePath(
		id: string,
		data: { storagePath: string; aceAudioPath?: string },
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/storage-path`, data)
	}

	setRating(id: string, rating: "up" | "down"): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/rating`, { rating })
	}

	updatePersonaExtract(
		id: string,
		personaExtract: string,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/persona-extract`, {
			personaExtract,
		})
	}

	addListen(id: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/listen`)
	}

	addPlayDuration(
		id: string,
		durationMs: number,
	): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/play-duration`, { durationMs })
	}

	retrySong(id: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/retry`)
	}

	deleteSong(id: string): Promise<{ ok: true }> {
		return this.delete(`/api/songs/${id}`)
	}

	revertSong(id: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/revert`)
	}

	revertTransientStatuses(playlistId: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/revert-transient/${playlistId}`)
	}

	recoverFromWorkerRestart(playlistId: string): Promise<number> {
		return this.post(`/api/songs/recover/${playlistId}`)
	}

	revertToMetadataReady(id: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/${id}/revert-to-metadata-ready`)
	}

	reorderSong(
		id: string,
		newOrderIndex: number,
	): Promise<{ ok: true }> {
		return this.patch(`/api/songs/${id}/order`, { newOrderIndex })
	}

	reindexPlaylist(playlistId: string): Promise<{ ok: true }> {
		return this.post(`/api/songs/reindex/${playlistId}`)
	}
}
