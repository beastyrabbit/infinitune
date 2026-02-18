import fs from "node:fs";
import path from "node:path";
import { toAceVocalLanguageCode } from "@infinitune/shared/lyrics-language";
import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import { saveCover } from "../covers";
import { submitToAce } from "../external/ace";
import { generateCover } from "../external/cover";
import {
	generatePlaylistManagerPlan,
	generateSongMetadata,
	type ManagerRatingSignal,
	type PromptDistance,
	type RecentSong,
	type SongMetadata,
} from "../external/llm";
import { saveSongToNfs } from "../external/storage";
import { tagMp3 } from "../external/tag-mp3";
import { songLogger } from "../logger";
import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";
import { type PlaylistWire, playlistToWire, type SongWire } from "../wire";
import { calculatePriority } from "./priority";
import type { EndpointQueues } from "./queues";

// ─── Types ───────────────────────────────────────────────────────────

export type SongWorkerStatus =
	| "running"
	| "completed"
	| "errored"
	| "cancelled";

export interface SongWorkerContext {
	queues: EndpointQueues;
	playlist: PlaylistWire;
	recentSongs: RecentSong[];
	recentDescriptions: string[];
	getPlaylistActive: () => Promise<boolean>;
	getCurrentEpoch?: () => number;
	getSettings: () => Promise<{
		textProvider: string;
		textModel: string;
		imageProvider: string;
		imageModel?: string;
	}>;
}

// ─── Duplicate Detection ─────────────────────────────────────────────

function isDuplicate(
	metadata: SongMetadata,
	recentSongs: RecentSong[],
): boolean {
	const newTitle = metadata.title.toLowerCase().trim();
	const newArtist = metadata.artistName.toLowerCase().trim();
	return recentSongs.some((s) => {
		const existingTitle = s.title.toLowerCase().trim();
		const existingArtist = s.artistName.toLowerCase().trim();
		return existingTitle === newTitle || existingArtist === newArtist;
	});
}

function pickManagerSlot(
	orderIndex: number,
	managerPlan?: PlaylistWire["managerPlan"] | null,
) {
	if (!managerPlan?.slots?.length) return undefined;
	const baseOrder = Number.isFinite(orderIndex) ? Math.max(1, orderIndex) : 1;
	const rawStartOrder = managerPlan.startOrderIndex;
	const startOrder =
		typeof rawStartOrder === "number" && Number.isFinite(rawStartOrder)
			? Math.max(1, Math.floor(rawStartOrder))
			: null;

	// Legacy fallback for plans created before startOrderIndex existed.
	if (startOrder === null) {
		const slotIndex =
			(Math.floor(baseOrder) - 1) % Math.max(1, managerPlan.slots.length);
		return managerPlan.slots[slotIndex];
	}

	const offset = Math.floor(baseOrder) - startOrder;
	if (offset < 0 || offset >= managerPlan.slots.length) {
		return undefined;
	}
	return managerPlan.slots[offset];
}

const managerRefreshInFlight = new Map<string, Promise<void>>();

function managerRefreshKey(playlistId: string, epoch: number): string {
	return `${playlistId}:${epoch}`;
}

function needsManagerRefresh(
	playlist: PlaylistWire,
	currentEpoch: number,
	orderIndex: number,
): boolean {
	const plan = playlist.managerPlan;
	const baseOrder = Number.isFinite(orderIndex)
		? Math.max(1, Math.floor(orderIndex))
		: 1;
	const rawPlanStartOrder = plan?.startOrderIndex;
	const planStartOrder =
		typeof rawPlanStartOrder === "number" && Number.isFinite(rawPlanStartOrder)
			? Math.max(1, Math.floor(rawPlanStartOrder))
			: null;
	const rawWindowSize = plan?.windowSize;
	const windowSize =
		typeof rawWindowSize === "number" && Number.isFinite(rawWindowSize)
			? Math.max(1, Math.floor(rawWindowSize))
			: Math.max(1, plan?.slots?.length ?? 1);
	const pastPlannedWindow =
		planStartOrder !== null && baseOrder >= planStartOrder + windowSize;

	return (
		!playlist.managerBrief?.trim() ||
		!plan?.slots?.length ||
		playlist.managerEpoch !== currentEpoch ||
		planStartOrder === null ||
		pastPlannedWindow
	);
}

// ─── SongWorker ──────────────────────────────────────────────────────

export class SongWorker {
	readonly songId: string;
	private song: SongWire;
	private ctx: SongWorkerContext;
	private aborted = false;
	private _status: SongWorkerStatus = "running";
	/** Cached cover image (base64 PNG). Set by startCover(), consumed by saveAndFinalize().
	 *  May be undefined if cover generation is still in-flight or failed. */
	private coverBase64: string | null = null;

	get status(): SongWorkerStatus {
		return this._status;
	}

	constructor(song: SongWire, ctx: SongWorkerContext) {
		this.songId = song.id;
		this.song = song;
		this.ctx = ctx;
	}

	/** Get the live current epoch, falling back to the snapshot if callback not provided */
	private getCurrentEpoch(): number {
		return this.ctx.getCurrentEpoch?.() ?? this.ctx.playlist.promptEpoch ?? 0;
	}

	private async loadLatestPlaylist(): Promise<PlaylistWire | null> {
		const latest = await playlistService.getById(this.ctx.playlist.id);
		return latest ? playlistToWire(latest) : null;
	}

	private async refreshPlaylistManager(
		currentEpoch: number,
		provider: "ollama" | "openrouter" | "openai-codex",
		model: string,
		signal?: AbortSignal,
	): Promise<void> {
		// Fast path: if local snapshot looks stale, pull once from DB before trying to refresh.
		if (
			needsManagerRefresh(this.ctx.playlist, currentEpoch, this.song.orderIndex)
		) {
			try {
				const latestPlaylist = await this.loadLatestPlaylist();
				if (latestPlaylist) {
					this.ctx.playlist = latestPlaylist;
				} else {
					this.aborted = true;
					songLogger(this.songId).info(
						{ playlistId: this.ctx.playlist.id, currentEpoch },
						"Playlist missing during manager refresh; cancelling song worker",
					);
					return;
				}
			} catch (err) {
				songLogger(this.songId).warn(
					{ err, playlistId: this.ctx.playlist.id, currentEpoch },
					"Failed to load latest playlist before manager refresh; continuing with in-memory snapshot",
				);
			}
		}

		if (
			!needsManagerRefresh(
				this.ctx.playlist,
				currentEpoch,
				this.song.orderIndex,
			)
		) {
			return;
		}

		const refreshKey = managerRefreshKey(this.ctx.playlist.id, currentEpoch);
		const inFlightRefresh = managerRefreshInFlight.get(refreshKey);

		if (inFlightRefresh) {
			try {
				await inFlightRefresh;
			} catch {
				// Best effort refresh: metadata generation continues below.
			}
			try {
				const latestPlaylist = await this.loadLatestPlaylist();
				if (latestPlaylist) {
					this.ctx.playlist = latestPlaylist;
				} else {
					this.aborted = true;
					songLogger(this.songId).info(
						{ playlistId: this.ctx.playlist.id, currentEpoch },
						"Playlist missing after in-flight manager refresh; cancelling song worker",
					);
				}
			} catch (err) {
				songLogger(this.songId).warn(
					{ err, playlistId: this.ctx.playlist.id, currentEpoch },
					"Failed to sync playlist after in-flight manager refresh; continuing with in-memory snapshot",
				);
			}
			return;
		}

		const runRefresh = async () => {
			try {
				const latestPlaylist = await this.loadLatestPlaylist();
				if (latestPlaylist) {
					this.ctx.playlist = latestPlaylist;
				} else {
					this.aborted = true;
					songLogger(this.songId).info(
						{ playlistId: this.ctx.playlist.id, currentEpoch },
						"Playlist missing before manager generation; cancelling song worker",
					);
					return;
				}
			} catch (err) {
				songLogger(this.songId).warn(
					{ err, playlistId: this.ctx.playlist.id, currentEpoch },
					"Failed to refresh playlist snapshot before manager generation; continuing with in-memory snapshot",
				);
			}

			if (
				!needsManagerRefresh(
					this.ctx.playlist,
					currentEpoch,
					this.song.orderIndex,
				)
			) {
				return;
			}

			try {
				const ratingSignals: ManagerRatingSignal[] = (
					await songService.listByPlaylist(this.ctx.playlist.id)
				)
					.filter(
						(song) => song.userRating === "up" || song.userRating === "down",
					)
					.sort((a, b) => b.orderIndex - a.orderIndex)
					.slice(0, 20)
					.map((song) => ({
						title: song.title || "Untitled",
						genre: song.genre || undefined,
						mood: song.mood || undefined,
						personaExtract: song.personaExtract || undefined,
						rating: song.userRating as "up" | "down",
					}));

				const { managerBrief, managerPlan } = await generatePlaylistManagerPlan(
					{
						prompt: this.ctx.playlist.prompt,
						provider,
						model,
						lyricsLanguage: this.ctx.playlist.lyricsLanguage ?? undefined,
						recentSongs: this.ctx.recentSongs,
						recentDescriptions: this.ctx.recentDescriptions,
						ratingSignals,
						steerHistory: this.ctx.playlist.steerHistory,
						previousBrief: this.ctx.playlist.managerBrief,
						currentEpoch,
						planWindow: 5,
						signal,
					},
				);
				await playlistService.updateManagerBrief(this.ctx.playlist.id, {
					managerBrief,
					managerPlan: JSON.stringify({
						...managerPlan,
						startOrderIndex: Math.max(1, Math.floor(this.song.orderIndex)),
					}),
					managerEpoch: currentEpoch,
				});
				this.ctx.playlist = {
					...this.ctx.playlist,
					managerBrief,
					managerPlan: {
						...managerPlan,
						startOrderIndex: Math.max(1, Math.floor(this.song.orderIndex)),
					},
					managerEpoch: currentEpoch,
					managerUpdatedAt: Date.now(),
				};
			} catch (err) {
				songLogger(this.songId).warn(
					{
						err,
						playlistId: this.ctx.playlist.id,
						currentEpoch,
					},
					"Playlist manager brief refresh failed; continuing with current context",
				);
			}
		};

		const trackedRefreshPromise = Promise.resolve().then(runRefresh);
		managerRefreshInFlight.set(refreshKey, trackedRefreshPromise);
		try {
			await trackedRefreshPromise;
		} finally {
			// Deleting after await is intentional: workers that miss this entry
			// still re-check fresh playlist state via needsManagerRefresh().
			managerRefreshInFlight.delete(refreshKey);
		}
	}

	private ensurePlaylistManagerRefresh(
		currentEpoch: number,
		provider: "ollama" | "openrouter" | "openai-codex",
		model: string,
	): void {
		if (
			!needsManagerRefresh(
				this.ctx.playlist,
				currentEpoch,
				this.song.orderIndex,
			)
		) {
			return;
		}

		const refreshKey = managerRefreshKey(this.ctx.playlist.id, currentEpoch);
		if (!managerRefreshInFlight.has(refreshKey)) {
			songLogger(this.songId).info(
				{
					playlistId: this.ctx.playlist.id,
					currentEpoch,
					orderIndex: this.song.orderIndex,
				},
				"Scheduling playlist manager refresh in background",
			);
		}

		// Manager refresh is intentionally best-effort and out-of-band so song
		// generation can start immediately. Updated manager context applies to
		// subsequent songs (or this one if refresh wins race before LLM execute).
		void this.refreshPlaylistManager(currentEpoch, provider, model).catch(
			(err) => {
				songLogger(this.songId).warn(
					{
						err,
						playlistId: this.ctx.playlist.id,
						currentEpoch,
					},
					"Background playlist manager refresh failed",
				);
			},
		);
	}

	/** Calculate queue priority for this song based on current playlist state */
	private getPriority(): number {
		return calculatePriority({
			isOneshot: this.ctx.playlist.mode === "oneshot",
			isInterrupt: !!this.song.interruptPrompt,
			orderIndex: this.song.orderIndex,
			currentOrderIndex: this.ctx.playlist.currentOrderIndex ?? 0,
			isClosing: this.ctx.playlist.status === "closing",
			currentEpoch: this.getCurrentEpoch(),
			songEpoch: this.song.promptEpoch ?? 0,
		});
	}

	/** Fire-and-forget entry point. Returns when song is ready/errored/cancelled. */
	async run(): Promise<void> {
		try {
			const initialStatus = this.song.status;

			// Determine starting point based on current status (recovery)
			switch (initialStatus) {
				case "pending":
					await this.generateMetadata();
					if (this.aborted) return;
					this.startCover(); // fire-and-forget
					await this.submitAndPollAudio();
					break;

				case "generating_metadata":
					// LLM work was lost (worker restart), revert and redo
					await songService.revertTransient(this.songId);
					await this.generateMetadata();
					if (this.aborted) return;
					this.startCover();
					await this.submitAndPollAudio();
					break;

				case "metadata_ready":
					// Skip metadata, start from cover+audio
					this.startCover();
					await this.submitAndPollAudio();
					break;

				case "submitting_to_ace":
					// ACE submission lost, revert and redo audio
					await songService.revertTransient(this.songId);
					this.startCover();
					await this.submitAndPollAudio();
					break;

				case "generating_audio":
					// Resume polling with existing aceTaskId
					if (this.song.aceTaskId) {
						await this.resumeAudioPoll();
					} else {
						// No taskId — revert and re-submit
						await songService.revertTransient(this.songId);
						await this.submitAndPollAudio();
					}
					break;

				case "saving":
					// Audio exists on ACE, re-poll to re-trigger save
					await songService.updateStatus(this.songId, "generating_audio");
					if (this.song.aceTaskId) {
						await this.resumeAudioPoll();
					} else {
						await songService.revertTransient(this.songId);
						await this.submitAndPollAudio();
					}
					break;

				default:
					// Song is in a terminal or non-actionable state
					this._status = "completed";
					return;
			}

			this._status = "completed";
		} catch (error: unknown) {
			if (this.aborted) {
				this._status = "cancelled";
				return;
			}
			this._status = "errored";
			const msg = error instanceof Error ? error.message : String(error);
			songLogger(this.songId).error({ error: msg }, "Song worker failed");
			try {
				await songService.markError(
					this.songId,
					msg || "Unexpected song worker failure",
				);
			} catch (markErr) {
				songLogger(this.songId).error(
					{ err: markErr },
					"Also failed to mark error status",
				);
			}
		}
	}

	cancel(): void {
		this.aborted = true;
		this.ctx.queues.cancelAllForSong(this.songId);
	}

	// ─── Pipeline Steps ──────────────────────────────────────────────

	private async generateMetadata(): Promise<void> {
		if (this.aborted) return;
		const active = await this.ctx.getPlaylistActive();
		if (!active) {
			this.aborted = true;
			songLogger(this.songId).info(
				{ playlistId: this.ctx.playlist.id },
				"Playlist is no longer active; skipping metadata generation",
			);
			return;
		}

		const claimed = songService.claimMetadata(this.songId);
		if (!claimed) return;

		songLogger(this.songId).info("Generating metadata");

		const settings = await this.ctx.getSettings();
		const { provider: effectiveProvider, model: effectiveModel } =
			resolveTextLlmProfile({
				provider: this.ctx.playlist.llmProvider || settings.textProvider,
				model: this.ctx.playlist.llmModel || settings.textModel,
			});

		const prompt = this.song.interruptPrompt || this.ctx.playlist.prompt;
		const isInterrupt = !!this.song.interruptPrompt;
		const isOneshot = this.ctx.playlist.mode === "oneshot";
		const currentEpoch = this.getCurrentEpoch();

		let promptDistance: PromptDistance = "faithful";
		if (!isInterrupt && !isOneshot) {
			promptDistance = Math.random() < 0.6 ? "close" : "general";
		}

		this.ensurePlaylistManagerRefresh(
			currentEpoch,
			effectiveProvider,
			effectiveModel,
		);

		try {
			const { result, processingMs } = await this.ctx.queues.llm.enqueue({
				songId: this.songId,
				priority: this.getPriority(),
				endpoint: effectiveProvider,
				execute: async (signal) => {
					const genOptions = {
						prompt,
						provider: effectiveProvider,
						model: effectiveModel,
						lyricsLanguage: this.ctx.playlist.lyricsLanguage ?? undefined,
						managerBrief: this.ctx.playlist.managerBrief ?? undefined,
						managerTransitionPolicy:
							this.ctx.playlist.managerPlan?.transitionPolicy,
						managerSlot: pickManagerSlot(
							this.song.orderIndex,
							this.ctx.playlist.managerPlan,
						),
						targetBpm: this.ctx.playlist.targetBpm ?? undefined,
						targetKey: this.ctx.playlist.targetKey ?? undefined,
						timeSignature: this.ctx.playlist.timeSignature ?? undefined,
						audioDuration: this.ctx.playlist.audioDuration ?? undefined,
						recentSongs: this.ctx.recentSongs,
						recentDescriptions: this.ctx.recentDescriptions,
						isInterrupt,
						promptDistance,
						signal,
					};

					let result = await generateSongMetadata(genOptions);

					// Hard dedup: if title or artist matches a recent song, retry once
					if (isDuplicate(result, this.ctx.recentSongs)) {
						songLogger(this.songId).info(
							{ title: result.title },
							"Duplicate detected, retrying",
						);
						result = await generateSongMetadata(genOptions);
						if (isDuplicate(result, this.ctx.recentSongs)) {
							songLogger(this.songId).warn(
								{ title: result.title },
								"Still duplicate after retry, accepting",
							);
						}
					}

					return result;
				},
			});

			const metadata = result as SongMetadata;

			if (this.aborted) return;

			await songService.completeMetadata(this.songId, {
				title: metadata.title,
				artistName: metadata.artistName,
				genre: metadata.genre,
				subGenre: metadata.subGenre || metadata.genre,
				lyrics: metadata.lyrics,
				caption: metadata.caption,
				vocalStyle: metadata.vocalStyle,
				coverPrompt: metadata.coverPrompt,
				bpm: metadata.bpm,
				keyScale: metadata.keyScale,
				timeSignature: metadata.timeSignature,
				audioDuration: metadata.audioDuration,
				mood: metadata.mood,
				energy: metadata.energy,
				era: metadata.era,
				instruments: metadata.instruments,
				tags: metadata.tags,
				themes: metadata.themes,
				language: metadata.language,
				description: metadata.description,
				llmProvider: effectiveProvider,
				llmModel: effectiveModel,
				metadataProcessingMs: processingMs,
			});

			// Update local song state
			this.song = { ...this.song, ...metadata, status: "metadata_ready" };

			songLogger(this.songId).info(
				{ title: metadata.title, artist: metadata.artistName, processingMs },
				"Metadata complete",
			);
		} catch (error: unknown) {
			if (this.aborted) return;
			const msg = error instanceof Error ? error.message : String(error);
			if (msg === "Cancelled") return;
			songLogger(this.songId).error(
				{ error: msg },
				"Metadata generation failed",
			);
			throw error;
		}
	}

	/** Fire-and-forget cover generation — best-effort, doesn't fail the song */
	private startCover(): void {
		if (this.aborted) return;
		if (!this.song.coverPrompt) return;
		if (this.song.coverUrl) return; // Already has cover art

		const songId = this.songId;
		const coverPrompt = this.song.coverPrompt;
		const priority = this.getPriority();

		// Fire-and-forget — we don't await this
		this.ctx
			.getSettings()
			.then((settings) => {
				const imageProvider =
					settings.imageProvider === "ollama"
						? "comfyui"
						: settings.imageProvider;
				const imageModel = settings.imageModel;

				return this.ctx.queues.image.enqueue({
					songId,
					priority,
					endpoint: imageProvider,
					execute: async (signal) => {
						const result = await generateCover({
							coverPrompt,
							provider: imageProvider,
							model: imageModel,
							signal,
						});
						if (!result) throw new Error("No cover generated");
						return { imageBase64: result.imageBase64 };
					},
				});
			})
			.then(async ({ result: coverResult, processingMs }) => {
				// Capture base64 for NFS save in saveAndFinalize()
				this.coverBase64 = coverResult.imageBase64;

				// Save cover image to disk and update song
				try {
					const { urlPath } = saveCover(
						Buffer.from(coverResult.imageBase64, "base64"),
						"png",
					);
					await songService.updateCover(songId, urlPath);
					this.song = { ...this.song, coverUrl: urlPath };
					songLogger(songId).info({ processingMs }, "Cover saved");
					await songService.updateCoverProcessingMs(songId, processingMs);
					return;
				} catch (saveErr) {
					songLogger(songId).warn(
						{ err: saveErr },
						"Cover save failed, falling back to data URL",
					);
				}

				await songService.updateCover(
					songId,
					`data:image/png;base64,${coverResult.imageBase64}`,
				);
				await songService.updateCoverProcessingMs(songId, processingMs);
			})
			.catch((error: unknown) => {
				if (this.aborted) return;
				const msg = error instanceof Error ? error.message : String(error);
				if (msg === "Cancelled") return;
				songLogger(songId).error(
					{ error: msg },
					"Cover generation failed (best-effort)",
				);
			});
	}

	private async submitAndPollAudio(): Promise<void> {
		if (this.aborted) return;

		// Check playlist still active before audio submission
		const active = await this.ctx.getPlaylistActive();
		if (!active && this.aborted) return;

		const claimed = songService.claimAudio(this.songId);
		if (!claimed) return;

		songLogger(this.songId).info(
			{ title: this.song.title },
			"Submitting to ACE-Step",
		);

		try {
			const { result: audioResult, processingMs } =
				await this.ctx.queues.audio.enqueue({
					songId: this.songId,
					priority: this.getPriority(),
					endpoint: "ace-step",
					execute: async (signal) => {
						const result = await submitToAce({
							lyrics: this.song.lyrics || "",
							caption: this.song.caption || "",
							vocalStyle: this.song.vocalStyle ?? undefined,
							bpm: this.song.bpm || 120,
							keyScale: this.song.keyScale || "C major",
							timeSignature: this.song.timeSignature || "4/4",
							audioDuration: this.song.audioDuration || 240,
							aceModel: (
								this.ctx.playlist as PlaylistWire & {
									aceModel?: string;
								}
							).aceModel,
							inferenceSteps: this.ctx.playlist.inferenceSteps ?? undefined,
							vocalLanguage: toAceVocalLanguageCode(
								this.ctx.playlist.lyricsLanguage,
							),
							lmTemperature: this.ctx.playlist.lmTemperature ?? undefined,
							lmCfgScale: this.ctx.playlist.lmCfgScale ?? undefined,
							inferMethod: this.ctx.playlist.inferMethod ?? undefined,
							signal,
						});

						if (signal.aborted) throw new Error("Cancelled");

						// Update DB with taskId
						await songService.updateAceTask(this.songId, result.taskId);

						songLogger(this.songId).info(
							{ aceTaskId: result.taskId, title: this.song.title },
							"ACE task submitted",
						);

						return {
							taskId: result.taskId,
							status: "running" as const,
							submitProcessingMs: 0,
						};
					},
				});

			if (this.aborted) return;

			await this.handleAudioResult(
				audioResult.taskId,
				audioResult.status,
				audioResult,
				processingMs,
			);
		} catch (error: unknown) {
			if (this.aborted) return;
			const msg = error instanceof Error ? error.message : String(error);
			if (msg === "Cancelled") return;
			songLogger(this.songId).error({ error: msg }, "Audio submission failed");
			throw error;
		}
	}

	private async resumeAudioPoll(): Promise<void> {
		if (this.aborted || !this.song.aceTaskId) return;

		songLogger(this.songId).info(
			{ aceTaskId: this.song.aceTaskId, title: this.song.title },
			"Resuming audio poll",
		);

		try {
			const { result: audioResult, processingMs } =
				await this.ctx.queues.audio.resumePoll(
					this.songId,
					this.song.aceTaskId,
					this.song.aceSubmittedAt || Date.now(),
				);

			if (this.aborted) return;

			await this.handleAudioResult(
				audioResult.taskId,
				audioResult.status,
				audioResult,
				processingMs,
			);
		} catch (error: unknown) {
			if (this.aborted) return;
			const msg = error instanceof Error ? error.message : String(error);
			if (msg === "Cancelled") return;
			songLogger(this.songId).error(
				{ error: msg },
				"Audio poll failed after resume",
			);
			throw error;
		}
	}

	private async handleAudioResult(
		taskId: string,
		status: string,
		audioResult: { audioPath?: string; error?: string },
		processingMs: number,
	): Promise<void> {
		if (status === "succeeded" && audioResult.audioPath) {
			await this.saveAndFinalize(audioResult.audioPath, processingMs);
		} else if (status === "failed") {
			songLogger(this.songId).error(
				{ error: audioResult.error },
				"ACE generation failed",
			);
			throw new Error(audioResult.error || "Audio generation failed");
		} else if (status === "not_found") {
			songLogger(this.songId).warn(
				{ aceTaskId: taskId, title: this.song.title },
				"ACE task lost, reverting",
			);
			await songService.revertTransient(this.songId);
			throw new Error("ACE task not found");
		}
	}

	private async saveAndFinalize(
		audioPath: string,
		audioProcessingMs: number,
	): Promise<void> {
		songLogger(this.songId).info(
			{ title: this.song.title },
			"ACE completed, saving",
		);

		await songService.updateStatus(this.songId, "saving");

		// Save to NFS
		try {
			// Determine cover data for NFS — prefer captured base64, fallback to reading from disk
			let coverBase64ForNfs: string | null = this.coverBase64;
			this.coverBase64 = null; // free memory
			if (
				!coverBase64ForNfs &&
				this.song.coverUrl &&
				!this.song.coverUrl.startsWith("data:")
			) {
				try {
					// Cover is on local disk — read it directly
					const coversDir = path.resolve(
						import.meta.dirname,
						"../../data/covers",
					);
					const coverFile = path.join(
						coversDir,
						path.basename(this.song.coverUrl),
					);
					if (fs.existsSync(coverFile)) {
						coverBase64ForNfs = fs.readFileSync(coverFile).toString("base64");
					}
				} catch (err) {
					songLogger(this.songId).warn({ err }, "Failed to read cover for NFS");
				}
			}

			const saveResult = await saveSongToNfs({
				songId: this.songId,
				title: this.song.title || "Unknown",
				artistName: this.song.artistName || "Unknown",
				genre: this.song.genre || "Unknown",
				subGenre: this.song.subGenre || this.song.genre || "Unknown",
				lyrics: this.song.lyrics || "",
				caption: this.song.caption || "",
				vocalStyle: this.song.vocalStyle ?? undefined,
				coverPrompt: this.song.coverPrompt ?? undefined,
				mood: this.song.mood ?? undefined,
				energy: this.song.energy ?? undefined,
				era: this.song.era ?? undefined,
				instruments: this.song.instruments,
				tags: this.song.tags,
				themes: this.song.themes,
				language: this.song.language ?? undefined,
				bpm: this.song.bpm || 120,
				keyScale: this.song.keyScale || "C major",
				timeSignature: this.song.timeSignature || "4/4",
				audioDuration: this.song.audioDuration || 240,
				aceAudioPath: audioPath,
				coverBase64: coverBase64ForNfs,
			});
			await songService.updateStoragePath(
				this.songId,
				saveResult.storagePath,
				audioPath,
			);
			// Update duration if silence was trimmed
			if (saveResult.effectiveDuration) {
				await songService.updateAudioDuration(
					this.songId,
					saveResult.effectiveDuration,
				);
			}

			// Write ID3 tags to the MP3
			try {
				const mp3Path = path.join(saveResult.storagePath, "audio.mp3");
				const coverPath = path.join(saveResult.storagePath, "cover.png");
				tagMp3(mp3Path, {
					title: this.song.title || "Untitled",
					artist: this.song.artistName || "Infinitune",
					album: this.ctx.playlist.name,
					genre: this.song.genre || "Electronic",
					subGenre: this.song.subGenre ?? null,
					bpm: this.song.bpm ?? null,
					year: new Date().getFullYear().toString(),
					trackNumber: this.song.orderIndex + 1,
					lyrics: this.song.lyrics ?? null,
					comment: this.song.caption ?? null,
					mood: this.song.mood ?? null,
					energy: this.song.energy ?? null,
					coverPath: fs.existsSync(coverPath) ? coverPath : null,
				});
			} catch (err) {
				songLogger(this.songId).warn({ err }, "ID3 tagging failed");
			}
		} catch (e: unknown) {
			songLogger(this.songId).error({ err: e }, "NFS save failed, continuing");
		}

		if (this.aborted) return;

		const audioUrl = `/api/songs/${this.songId}/audio`;
		await songService.markReady(this.songId, audioUrl, audioProcessingMs);
		await playlistService.incrementGenerated(this.ctx.playlist.id);

		songLogger(this.songId).info(
			{ title: this.song.title, audioProcessingMs },
			"Song is READY",
		);
	}
}
