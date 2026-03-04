import { useQuery } from "@tanstack/react-query";
import { api } from "@/integrations/api/client";

export interface EndpointStatus {
	type: string;
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
 * 10s refetchInterval as safety net fallback.
 */
export function useWorkerStatus(): {
	status: WorkerStatus | null;
	error: string | null;
} {
	const { data, error } = useQuery({
		queryKey: ["worker", "status"],
		queryFn: () => api.get<WorkerStatus>("/api/worker/status"),
		refetchInterval: 10_000,
		staleTime: 2_000,
	});

	return {
		status: data ?? null,
		error: error
			? error instanceof Error
				? error.message
				: String(error)
			: null,
	};
}

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
		error: error
			? error instanceof Error
				? error.message
				: String(error)
			: null,
	};
}
