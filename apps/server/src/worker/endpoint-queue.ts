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
export interface CompletionStats {
	lastMs: number | null;
	avgMs: number | null;
	maxMs: number | null;
	totalCompleted: number;
}

export function computeCompletionStats(
	history: number[],
	totalCompleted: number,
): CompletionStats {
	if (history.length === 0) {
		return { lastMs: null, avgMs: null, maxMs: null, totalCompleted };
	}
	return {
		lastMs: history[history.length - 1],
		avgMs: Math.round(history.reduce((a, b) => a + b, 0) / history.length),
		maxMs: Math.max(...history),
		totalCompleted,
	};
}

/** Record a completion time and keep the history bounded to 20 entries */
export function recordCompletion(history: number[], durationMs: number): void {
	history.push(durationMs);
	if (history.length > 20) {
		history.shift();
	}
}

export interface QueueStatus {
	type: EndpointType;
	pending: number;
	active: number;
	errors: number;
	lastErrorMessage?: string;
	completionStats: CompletionStats;
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
