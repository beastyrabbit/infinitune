import { useQuery } from "@tanstack/react-query";
import { api } from "@/integrations/api/client";

function formatQueryError(
	error: Error | null,
	fallback = "Failed to fetch data",
): string | null {
	if (!error) return null;
	return error.message || fallback;
}

export interface CompletionStats {
	lastMs: number | null;
	avgMs: number | null;
	maxMs: number | null;
	totalCompleted: number;
}

export interface EndpointStatus {
	type: string;
	pending: number;
	active: number;
	errors: number;
	lastErrorMessage?: string;
	completionStats?: CompletionStats;
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

export interface WorkerStatus {
	actorGraph?: {
		playlists: {
			playlistId: string;
			status: string;
		}[];
		songs: {
			songId: string;
			status: string;
		}[];
	};
	queues: {
		llm: EndpointStatus;
		image: EndpointStatus;
		audio: EndpointStatus;
	};
	songWorkers: number;
	playlists: { id: string; name: string; activeSongWorkers: number }[];
	uptime: number;
}

export interface WorkerInspectEvent {
	at: number;
	event: unknown;
}

export interface WorkerInspect {
	enabled: boolean;
	maxEvents: number;
	events: WorkerInspectEvent[];
}

/**
 * Fetches worker status via React Query, invalidated by WS events.
 * 5s refetchInterval as safety net fallback.
 */
export function useWorkerStatus(): {
	status: WorkerStatus | null;
	error: string | null;
} {
	const { data, error } = useQuery({
		queryKey: ["worker", "status"],
		queryFn: () => api.get<WorkerStatus>("/api/worker/status"),
		refetchInterval: 5_000,
		staleTime: 2_000,
	});

	return {
		status: data ?? null,
		error: formatQueryError(error, "Failed to fetch worker status"),
	};
}

/** Fetches worker event inspector data via React Query. Polled every 3s (no WS invalidation). */
export function useWorkerInspect(limit = 100): {
	inspect: WorkerInspect | null;
	error: string | null;
} {
	const requestedLimit = limit > 0 ? limit : 100;
	const { data, error } = useQuery({
		queryKey: ["worker", "inspect", requestedLimit],
		queryFn: () =>
			api.get<WorkerInspect>(`/api/worker/inspect?limit=${requestedLimit}`),
		refetchInterval: 3_000,
		staleTime: 1_000,
	});

	return {
		inspect: data ?? null,
		error: formatQueryError(error, "Failed to fetch worker inspection log"),
	};
}
