import { logger } from "../logger";

// ─── Endpoint Types ──────────────────────────────────────────────────
export type EndpointType = "llm" | "image" | "audio";

// ─── Queue Request / Result ──────────────────────────────────────────
export interface QueueRequest<T> {
	songId: string;
	priority: number;
	endpoint?: string;
	execute: (signal: AbortSignal) => Promise<T>;
}

export interface QueueResult<T> {
	result: T;
	processingMs: number;
}

// ─── Queue Status ────────────────────────────────────────────────────
export interface QueueStatus {
	type: EndpointType;
	pending: number;
	active: number;
	errors: number;
	lastErrorMessage?: string;
	activeItems: {
		songId: string;
		startedAt: number;
		endpoint?: string;
		priority: number;
	}[];
	pendingItems: {
		songId: string;
		priority: number;
		waitingSince: number;
		endpoint?: string;
	}[];
}

// ─── Interface ───────────────────────────────────────────────────────
export interface IEndpointQueue<T> {
	readonly type: EndpointType;
	enqueue(request: QueueRequest<T>): Promise<QueueResult<T>>;
	cancelSong(songId: string): void;
	getStatus(): QueueStatus;
	refreshConcurrency(maxConcurrency: number): void;
	updatePendingPriority(songId: string, newPriority: number): void;
	resortPending(): void;
}

// ─── Internal tracking types ─────────────────────────────────────────
interface PendingItem<T> {
	request: QueueRequest<T>;
	resolve: (result: QueueResult<T>) => void;
	reject: (error: Error) => void;
	enqueuedAt: number;
}

interface ActiveItem {
	songId: string;
	startedAt: number;
	endpoint?: string;
	priority: number;
	abortController: AbortController;
}

// ─── Base class ──────────────────────────────────────────────────────
export abstract class BaseEndpointQueue<T> implements IEndpointQueue<T> {
	readonly type: EndpointType;
	protected maxConcurrency: number;

	private pending: PendingItem<T>[] = [];
	private active = new Map<string, ActiveItem>();
	private draining = false;
	private errorCount = 0;
	private lastErrorMessage?: string;

	constructor(type: EndpointType, maxConcurrency: number) {
		this.type = type;
		this.maxConcurrency = maxConcurrency;
	}

	enqueue(request: QueueRequest<T>): Promise<QueueResult<T>> {
		return new Promise<QueueResult<T>>((resolve, reject) => {
			const item: PendingItem<T> = {
				request,
				resolve,
				reject,
				enqueuedAt: Date.now(),
			};

			// Sorted insert: lower priority number = higher priority, FIFO tiebreak
			const idx = this.pending.findIndex(
				(p) => p.request.priority > request.priority,
			);
			if (idx === -1) {
				this.pending.push(item);
			} else {
				this.pending.splice(idx, 0, item);
			}

			this.drain();
		});
	}

	cancelSong(songId: string): void {
		// Remove from pending
		const pendingIdx = this.pending.findIndex(
			(p) => p.request.songId === songId,
		);
		if (pendingIdx !== -1) {
			const [removed] = this.pending.splice(pendingIdx, 1);
			removed.reject(new Error("Cancelled"));
		}

		// Abort if active
		const activeItem = this.active.get(songId);
		if (activeItem) {
			activeItem.abortController.abort();
		}
	}

	getStatus(): QueueStatus {
		return {
			type: this.type,
			pending: this.pending.length,
			active: this.active.size,
			errors: this.errorCount,
			lastErrorMessage: this.lastErrorMessage,
			activeItems: [...this.active.values()].map((a) => ({
				songId: a.songId,
				startedAt: a.startedAt,
				endpoint: a.endpoint,
				priority: a.priority,
			})),
			pendingItems: this.pending.map((p) => ({
				songId: p.request.songId,
				priority: p.request.priority,
				waitingSince: p.enqueuedAt,
				endpoint: p.request.endpoint,
			})),
		};
	}

	refreshConcurrency(maxConcurrency: number): void {
		this.maxConcurrency = maxConcurrency;
		this.drain();
	}

	/** Update the priority of a pending item by songId */
	updatePendingPriority(songId: string, newPriority: number): void {
		const item = this.pending.find((p) => p.request.songId === songId);
		if (item) {
			item.request.priority = newPriority;
		}
	}

	/** Re-sort pending queue (used when priorities change, e.g. playlist goes stale) */
	resortPending(): void {
		this.pending.sort((a, b) => a.request.priority - b.request.priority);
	}

	private drain(): void {
		if (this.draining) return;
		this.draining = true;

		try {
			while (
				this.active.size < this.maxConcurrency &&
				this.pending.length > 0
			) {
				const item = this.pending.shift()!;
				this.executeItem(item);
			}
		} finally {
			this.draining = false;
		}
	}

	private executeItem(item: PendingItem<T>): void {
		const songId = item.request.songId;
		const abortController = new AbortController();
		const startedAt = Date.now();
		const waitMs = startedAt - item.enqueuedAt;

		const activeItem: ActiveItem = {
			songId,
			startedAt,
			endpoint: item.request.endpoint,
			priority: item.request.priority,
			abortController,
		};
		this.active.set(songId, activeItem);
		logger.debug(
			{
				queueType: this.type,
				songId,
				endpoint: item.request.endpoint,
				priority: item.request.priority,
				waitMs,
				pendingAfterDequeue: this.pending.length,
				activeCount: this.active.size,
			},
			"Queue item started",
		);

		item.request
			.execute(abortController.signal)
			.then((result) => {
				const processingMs = Date.now() - startedAt;
				logger.debug(
					{
						queueType: this.type,
						songId,
						endpoint: item.request.endpoint,
						priority: item.request.priority,
						waitMs,
						processingMs,
						activeCount: this.active.size,
					},
					"Queue item completed",
				);
				item.resolve({ result, processingMs });
			})
			.catch((error: unknown) => {
				this.errorCount++;
				this.lastErrorMessage =
					error instanceof Error ? error.message : String(error);
				const message =
					error instanceof Error ? error.message : "Queue item failed";
				if (message === "Cancelled") {
					logger.debug(
						{
							queueType: this.type,
							songId,
							endpoint: item.request.endpoint,
							priority: item.request.priority,
							waitMs,
							processingMs: Date.now() - startedAt,
						},
						"Queue item cancelled",
					);
				} else {
					logger.warn(
						{
							queueType: this.type,
							songId,
							endpoint: item.request.endpoint,
							priority: item.request.priority,
							waitMs,
							processingMs: Date.now() - startedAt,
							err: error,
						},
						"Queue item failed",
					);
				}
				item.reject(error instanceof Error ? error : new Error(String(error)));
			})
			.finally(() => {
				this.active.delete(songId);
				logger.debug(
					{
						queueType: this.type,
						songId,
						pendingCount: this.pending.length,
						activeCount: this.active.size,
					},
					"Queue slot released",
				);
				this.drain();
			});
	}
}
