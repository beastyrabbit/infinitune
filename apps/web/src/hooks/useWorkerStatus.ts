import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/endpoints";

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

const POLL_INTERVAL_MS = 2000;
const INSPECT_POLL_INTERVAL_MS = 3000;

/**
 * Polls the worker HTTP API every 2 seconds for queue status.
 */
export function useWorkerStatus(): {
	status: WorkerStatus | null;
	error: string | null;
} {
	const [status, setStatus] = useState<WorkerStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		const fetchStatus = async () => {
			try {
				const res = await fetch(`${API_URL}/api/worker/status`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				setStatus(data);
				setError(null);
			} catch (e: unknown) {
				setError(
					e instanceof Error ? e.message : "Failed to fetch worker status",
				);
			}
		};

		fetchStatus();
		intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, []);

	return { status, error };
}

export function useWorkerInspect(limit = 100): {
	inspect: WorkerInspect | null;
	error: string | null;
} {
	const [inspect, setInspect] = useState<WorkerInspect | null>(null);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const requestedLimit = limit > 0 ? limit : 100;

	useEffect(() => {
		const fetchInspect = async () => {
			try {
				const res = await fetch(
					`${API_URL}/api/worker/inspect?limit=${requestedLimit}`,
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				setInspect(data);
				setError(null);
			} catch (e: unknown) {
				setError(
					e instanceof Error
						? e.message
						: "Failed to fetch worker inspection log",
				);
			}
		};

		fetchInspect();
		intervalRef.current = setInterval(fetchInspect, INSPECT_POLL_INTERVAL_MS);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [requestedLimit]);

	return { inspect, error };
}
