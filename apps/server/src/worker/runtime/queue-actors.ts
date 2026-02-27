import { createActor, fromCallback } from "xstate";
import { logger } from "../../logger";
import type {
	IEndpointQueue,
	QueueRequest,
	QueueResult,
	QueueStatus,
} from "../endpoint-queue";
import { getWorkerInspectObserver } from "./inspection";

interface InternalQueueItem<T> extends QueueRequest<T> {
	resolve: (result: QueueResult<T>) => void;
	reject: (error: Error) => void;
	enqueuedAt: number;
}

interface InternalQueueActiveItem {
	abortController: AbortController;
	priority: number;
	startedAt: number;
	endpoint?: string;
}

const compareQueueItems = <T>(
	a: InternalQueueItem<T>,
	b: InternalQueueItem<T>,
) => {
	const priorityDiff = a.priority - b.priority;
	if (priorityDiff !== 0) return priorityDiff;
	return a.enqueuedAt - b.enqueuedAt;
};

interface RequestResponseQueueEvent<T> {
	type:
		| "enqueue"
		| "cancelSong"
		| "refreshConcurrency"
		| "resortPending"
		| "drain"
		| "updatePendingPriority";
	item?: InternalQueueItem<T>;
	songId?: string;
	maxConcurrency?: number;
	newPriority?: number;
}

export class RequestResponseQueue<T> implements IEndpointQueue<T> {
	private readonly actor;
	private readonly state: {
		queueType: string;
		pending: Array<InternalQueueItem<T>>;
		active: Map<string, InternalQueueActiveItem>;
		maxConcurrency: number;
		errorCount: number;
		lastErrorMessage?: string;
	} = {
		queueType: "unknown",
		pending: [],
		active: new Map(),
		maxConcurrency: 1,
		errorCount: 0,
	};

	constructor(type: "llm" | "image", maxConcurrency: number) {
		this.state.queueType = type;
		this.state.maxConcurrency = Math.max(1, maxConcurrency);

		this.actor = createActor(
			fromCallback<RequestResponseQueueEvent<T>>(({ receive }) => {
				const executeItem = async (
					item: InternalQueueItem<T>,
				): Promise<void> => {
					const abortController = new AbortController();
					const startedAt = Date.now();
					const waitMs = startedAt - item.enqueuedAt;

					const activeItem: InternalQueueActiveItem = {
						abortController,
						priority: item.priority,
						startedAt,
						endpoint: item.endpoint,
					};
					this.state.active.set(item.songId, activeItem);

					logger.debug(
						{
							queueType: this.state.queueType,
							songId: item.songId,
							endpoint: item.endpoint,
							priority: item.priority,
							waitMs,
							pendingAfterDequeue: this.state.pending.length,
							activeCount: this.state.active.size,
						},
						"Queue item started",
					);

					try {
						const result = await item.execute(abortController.signal);
						const processingMs = Date.now() - startedAt;
						logger.debug(
							{
								queueType: this.state.queueType,
								songId: item.songId,
								endpoint: item.endpoint,
								priority: item.priority,
								waitMs,
								processingMs,
								activeCount: this.state.active.size,
							},
							"Queue item completed",
						);
						item.resolve({ result, processingMs });
					} catch (error: unknown) {
						this.state.errorCount += 1;
						const message =
							error instanceof Error ? error.message : String(error);
						this.state.lastErrorMessage = message;
						const processingMs = Date.now() - startedAt;

						if (message === "Cancelled") {
							logger.debug(
								{
									queueType: this.state.queueType,
									songId: item.songId,
									endpoint: item.endpoint,
									priority: item.priority,
									waitMs,
									processingMs,
								},
								"Queue item cancelled",
							);
						} else {
							logger.warn(
								{
									queueType: this.state.queueType,
									songId: item.songId,
									endpoint: item.endpoint,
									priority: item.priority,
									waitMs,
									processingMs,
									err: error,
								},
								"Queue item failed",
							);
						}

						item.reject(
							error instanceof Error ? error : new Error(String(error)),
						);
					} finally {
						this.state.active.delete(item.songId);
						logger.debug(
							{
								queueType: this.state.queueType,
								songId: item.songId,
								pendingCount: this.state.pending.length,
								activeCount: this.state.active.size,
							},
							"Queue slot released",
						);
						this.actor.send({ type: "drain" });
					}
				};

				const drain = () => {
					while (
						this.state.active.size < this.state.maxConcurrency &&
						this.state.pending.length > 0
					) {
						const item = this.state.pending.shift();
						if (!item) return;
						void executeItem(item);
					}
				};

				receive((event) => {
					switch (event.type) {
						case "enqueue":
							if (event.item) {
								this.state.pending.push(event.item);
								this.state.pending.sort(compareQueueItems);
								drain();
							}
							break;
						case "cancelSong":
							if (!event.songId) return;
							{
								const removed = this.state.pending.filter(
									(item) => item.songId === event.songId,
								);
								if (removed.length > 0) {
									this.state.pending = this.state.pending.filter(
										(item) => item.songId !== event.songId,
									);
									for (const item of removed) {
										item.reject(new Error("Cancelled"));
									}
								}

								const active = this.state.active.get(event.songId);
								if (active) {
									active.abortController.abort();
								}
							}
							break;
						case "refreshConcurrency":
							if (event.maxConcurrency && event.maxConcurrency > 0) {
								this.state.maxConcurrency = event.maxConcurrency;
								drain();
							}
							break;
						case "updatePendingPriority":
							if (event.songId && event.newPriority !== undefined) {
								const item = this.state.pending.find(
									(p) => p.songId === event.songId,
								);
								if (item) {
									item.priority = event.newPriority;
									this.state.pending.sort(compareQueueItems);
								}
							}
							break;
						case "resortPending":
							this.state.pending.sort(compareQueueItems);
							break;
						case "drain":
							drain();
							break;
					}
				});
			}),
			{ inspect: getWorkerInspectObserver() },
		);
		this.actor.start();
	}

	get type(): "llm" | "image" {
		return this.state.queueType as "llm" | "image";
	}

	enqueue(request: QueueRequest<T>): Promise<QueueResult<T>> {
		return new Promise<QueueResult<T>>((resolve, reject) => {
			const item: InternalQueueItem<T> = {
				...request,
				resolve,
				reject,
				enqueuedAt: Date.now(),
			};
			this.actor.send({ type: "enqueue", item });
		});
	}

	cancelSong(songId: string): void {
		this.actor.send({ type: "cancelSong", songId });
	}

	refreshConcurrency(maxConcurrency: number): void {
		this.actor.send({ type: "refreshConcurrency", maxConcurrency });
	}

	updatePendingPriority(songId: string, newPriority: number): void {
		this.actor.send({
			type: "updatePendingPriority",
			songId,
			newPriority,
		});
	}

	resortPending(): void {
		this.actor.send({ type: "resortPending" });
	}

	getStatus(): QueueStatus {
		return {
			type: this.type,
			pending: this.state.pending.length,
			active: this.state.active.size,
			errors: this.state.errorCount,
			lastErrorMessage: this.state.lastErrorMessage,
			activeItems: [...this.state.active.entries()].map(([songId, item]) => ({
				songId,
				startedAt: item.startedAt,
				endpoint: item.endpoint,
				priority: item.priority,
			})),
			pendingItems: this.state.pending.map((item) => ({
				songId: item.songId,
				priority: item.priority,
				waitingSince: item.enqueuedAt,
				endpoint: item.endpoint,
			})),
		};
	}
}

interface AudioTaskResult {
	taskId: string;
	status: "running" | "succeeded" | "failed" | "not_found";
	audioPath?: string;
	error?: string;
	submitProcessingMs?: number;
}

interface AudioQueueItem extends QueueRequest<AudioTaskResult> {
	resolve: (result: QueueResult<AudioTaskResult>) => void;
	reject: (error: Error) => void;
	enqueuedAt: number;
	resumeTaskId?: string;
	resumeSubmittedAt?: number;
}

interface AudioActiveSlot {
	songId: string;
	taskId: string;
	submittedAt: number;
	startedAt: number;
	waitMs: number;
	submitProcessingMs: number;
	priority: number;
	resolve: (result: QueueResult<AudioTaskResult>) => void;
	reject: (error: Error) => void;
	abortController: AbortController;
}

const NOT_FOUND_GRACE_MS = 2 * 60 * 1000;

interface AudioQueueEvent {
	type:
		| "enqueue"
		| "resume"
		| "tickPolls"
		| "cancelSong"
		| "drain"
		| "resortPending"
		| "updatePendingPriority";
	item?: AudioQueueItem;
	songId?: string;
	newPriority?: number;
}

export class AudioQueue implements IEndpointQueue<AudioTaskResult> {
	readonly type = "audio" as const;
	private readonly actor;
	private readonly state = {
		pending: [] as AudioQueueItem[],
		active: null as AudioActiveSlot | null,
		errorCount: 0,
		lastErrorMessage: undefined as string | undefined,
	};
	private readonly pollFn: (
		taskId: string,
		signal: AbortSignal,
	) => Promise<{
		status: "running" | "succeeded" | "failed" | "not_found";
		audioPath?: string;
		error?: string;
	}>;

	constructor(
		pollFn: (
			taskId: string,
			signal: AbortSignal,
		) => Promise<{
			status: "running" | "succeeded" | "failed" | "not_found";
			audioPath?: string;
			error?: string;
		}>,
	) {
		this.pollFn = pollFn;

		this.actor = createActor(
			fromCallback<AudioQueueEvent>(({ receive }) => {
				const clearSlot = () => {
					this.state.active = null;
					this.actor.send({ type: "drain" });
				};

				const startSlot = (item: AudioQueueItem): void => {
					const abortController = new AbortController();
					const startedAt = Date.now();
					const waitMs = startedAt - item.enqueuedAt;

					if (item.resumeTaskId) {
						this.state.active = {
							songId: item.songId,
							taskId: item.resumeTaskId,
							submittedAt: item.resumeSubmittedAt || Date.now(),
							startedAt,
							waitMs,
							submitProcessingMs: 0,
							priority: item.priority,
							resolve: item.resolve,
							reject: item.reject,
							abortController,
						};

						logger.debug(
							{
								queueType: this.type,
								songId: item.songId,
								taskId: item.resumeTaskId,
								priority: item.priority,
								waitMs,
								pendingAfterDequeue: this.state.pending.length,
							},
							"Audio queue resumed task",
						);
						return;
					}

					const submittedAt = Date.now();
					this.state.active = {
						songId: item.songId,
						taskId: "",
						submittedAt,
						startedAt,
						waitMs,
						submitProcessingMs: 0,
						priority: item.priority,
						resolve: item.resolve,
						reject: item.reject,
						abortController,
					};

					logger.debug(
						{
							queueType: this.type,
							songId: item.songId,
							priority: item.priority,
							waitMs,
							pendingAfterDequeue: this.state.pending.length,
						},
						"Audio queue submission started",
					);

					item
						.execute(abortController.signal)
						.then((result: AudioTaskResult) => {
							if (abortController.signal.aborted) return;
							if (
								!this.state.active ||
								this.state.active.songId !== item.songId
							) {
								return;
							}
							this.state.active.taskId = result.taskId;
							this.state.active.submittedAt = Date.now();
							this.state.active.submitProcessingMs = Date.now() - submittedAt;
							logger.debug(
								{
									queueType: this.type,
									songId: item.songId,
									taskId: result.taskId,
									priority: item.priority,
									waitMs,
									submitProcessingMs: this.state.active.submitProcessingMs,
								},
								"Audio queue submission complete, polling started",
							);
						})
						.catch((error: unknown) => {
							if (
								!this.state.active ||
								this.state.active.songId !== item.songId
							) {
								return;
							}

							const message =
								error instanceof Error ? error.message : String(error);
							this.state.errorCount += 1;
							this.state.lastErrorMessage = message;
							const processingMs = Date.now() - submittedAt;

							if (message === "Cancelled") {
								logger.debug(
									{
										queueType: this.type,
										songId: item.songId,
										priority: item.priority,
										waitMs,
										submitProcessingMs: processingMs,
									},
									"Audio queue submission cancelled",
								);
								item.reject(new Error("Cancelled"));
							} else {
								logger.warn(
									{
										queueType: this.type,
										songId: item.songId,
										priority: item.priority,
										waitMs,
										submitProcessingMs: processingMs,
										err: error,
									},
									"Audio queue submission failed",
								);
								item.reject(
									error instanceof Error ? error : new Error(String(error)),
								);
							}

							clearSlot();
						});
				};

				const drain = () => {
					if (this.state.active || this.state.pending.length === 0) return;
					const item = this.state.pending.shift();
					if (!item) return;
					startSlot(item);
				};

				const pollActive = async () => {
					const slot = this.state.active;
					if (!slot) return;
					if (slot.abortController.signal.aborted) {
						clearSlot();
						return;
					}

					try {
						const pollResult = await this.pollFn(
							slot.taskId,
							slot.abortController.signal,
						);
						if (slot.abortController.signal.aborted) return;

						if (pollResult.status === "succeeded") {
							logger.debug(
								{
									queueType: this.type,
									songId: slot.songId,
									taskId: slot.taskId,
									priority: slot.priority,
									waitMs: slot.waitMs,
									submitProcessingMs: slot.submitProcessingMs,
									pollingMs: Date.now() - slot.submittedAt,
									totalMs: Date.now() - slot.startedAt,
								},
								"Audio queue task completed",
							);
							slot.resolve({
								result: {
									taskId: slot.taskId,
									status: "succeeded",
									audioPath: pollResult.audioPath,
									submitProcessingMs: slot.submitProcessingMs,
								},
								processingMs: Date.now() - slot.submittedAt,
							});
							clearSlot();
						} else if (pollResult.status === "failed") {
							const message = pollResult.error || "Audio generation failed";
							this.state.errorCount += 1;
							this.state.lastErrorMessage = message;
							logger.warn(
								{
									queueType: this.type,
									songId: slot.songId,
									taskId: slot.taskId,
									priority: slot.priority,
									waitMs: slot.waitMs,
									submitProcessingMs: slot.submitProcessingMs,
									pollingMs: Date.now() - slot.submittedAt,
									totalMs: Date.now() - slot.startedAt,
									error: message,
								},
								"Audio queue task failed",
							);
							slot.resolve({
								result: {
									taskId: slot.taskId,
									status: "failed",
									error: message,
									submitProcessingMs: slot.submitProcessingMs,
								},
								processingMs: Date.now() - slot.submittedAt,
							});
							clearSlot();
						} else if (pollResult.status === "not_found") {
							const elapsed = Date.now() - slot.submittedAt;
							if (elapsed >= NOT_FOUND_GRACE_MS) {
								logger.warn(
									{
										queueType: this.type,
										songId: slot.songId,
										taskId: slot.taskId,
										priority: slot.priority,
										waitMs: slot.waitMs,
										submitProcessingMs: slot.submitProcessingMs,
										pollingMs: elapsed,
										totalMs: Date.now() - slot.startedAt,
									},
									"Audio queue task not found after grace period",
								);
								slot.resolve({
									result: {
										taskId: slot.taskId,
										status: "not_found",
										submitProcessingMs: slot.submitProcessingMs,
									},
									processingMs: elapsed,
								});
								clearSlot();
							}
						}
					} catch (error: unknown) {
						if (slot.abortController.signal.aborted) return;
						logger.error(
							{ err: error, taskId: slot.taskId },
							"Audio queue poll error",
						);
					}
				};

				receive((event) => {
					switch (event.type) {
						case "enqueue":
							if (event.item) {
								this.state.pending.push(event.item);
								this.state.pending.sort(compareQueueItems);
								drain();
							}
							break;
						case "resume":
							if (event.item) {
								this.state.pending.push(event.item);
								this.state.pending.sort(compareQueueItems);
								drain();
							}
							break;
						case "tickPolls":
							void pollActive();
							break;
						case "cancelSong":
							if (!event.songId) return;
							{
								const removed = this.state.pending.filter(
									(item) => item.songId === event.songId,
								);
								if (removed.length > 0) {
									this.state.pending = this.state.pending.filter(
										(item) => item.songId !== event.songId,
									);
									for (const item of removed) {
										item.reject(new Error("Cancelled"));
									}
								}

								const active = this.state.active;
								if (active && active.songId === event.songId) {
									active.abortController.abort();
									active.reject(new Error("Cancelled"));
									clearSlot();
								}
							}
							break;
						case "resortPending":
							this.state.pending.sort(compareQueueItems);
							break;
						case "updatePendingPriority":
							if (!event.songId || event.newPriority === undefined) return;
							{
								const item = this.state.pending.find(
									(p) => p.songId === event.songId,
								);
								if (item) {
									item.priority = event.newPriority;
									this.state.pending.sort(compareQueueItems);
								}
							}
							break;
						case "drain":
							drain();
							break;
					}
				});
			}),
			{ inspect: getWorkerInspectObserver() },
		);
		this.actor.start();
	}

	enqueue(
		request: QueueRequest<AudioTaskResult>,
	): Promise<QueueResult<AudioTaskResult>> {
		return new Promise<QueueResult<AudioTaskResult>>((resolve, reject) => {
			const item: AudioQueueItem = {
				...request,
				resolve,
				reject,
				enqueuedAt: Date.now(),
			};
			this.actor.send({ type: "enqueue", item });
		});
	}

	resumePoll(
		songId: string,
		taskId: string,
		submittedAt: number,
	): Promise<QueueResult<AudioTaskResult>> {
		return new Promise<QueueResult<AudioTaskResult>>((resolve, reject) => {
			const item: AudioQueueItem = {
				songId,
				priority: 0,
				endpoint: "ace-step",
				execute: async () => {
					throw new Error("Resume poll entries do not run submission");
				},
				resumeTaskId: taskId,
				resumeSubmittedAt: submittedAt,
				resolve,
				reject,
				enqueuedAt: Date.now(),
			};
			this.actor.send({ type: "resume", item });
		});
	}

	tickPolls(): Promise<void> {
		this.actor.send({ type: "tickPolls" });
		return Promise.resolve();
	}

	cancelSong(songId: string): void {
		this.actor.send({ type: "cancelSong", songId });
	}

	getStatus(): QueueStatus {
		return {
			type: this.type,
			pending: this.state.pending.length,
			active: this.state.active ? 1 : 0,
			errors: this.state.errorCount,
			lastErrorMessage: this.state.lastErrorMessage,
			activeItems: this.state.active
				? [
						{
							songId: this.state.active.songId,
							startedAt: this.state.active.startedAt,
							endpoint: "ace-step",
							priority: this.state.active.priority,
						},
					]
				: [],
			pendingItems: this.state.pending.map((item) => ({
				songId: item.songId,
				priority: item.priority,
				waitingSince: item.enqueuedAt,
				endpoint: item.endpoint,
			})),
		};
	}

	updatePendingPriority(songId: string, newPriority: number): void {
		this.actor.send({ type: "updatePendingPriority", songId, newPriority });
	}

	resortPending(): void {
		this.actor.send({ type: "resortPending" });
	}

	refreshConcurrency(_maxConcurrency?: number): void {
		// Audio queue intentionally remains single-slot.
	}
}
