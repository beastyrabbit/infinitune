import { useEffect, useRef, useState } from "react";

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
	queues: {
		llm: EndpointStatus;
		image: EndpointStatus;
		audio: EndpointStatus;
	};
	songWorkers: number;
	playlists: { id: string; name: string; activeSongWorkers: number }[];
	uptime: number;
}

const POLL_INTERVAL_MS = 2000;

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
		const workerApiUrl =
			import.meta.env.VITE_API_URL || "http://localhost:5175";

		const fetchStatus = async () => {
			try {
				const res = await fetch(`${workerApiUrl}/api/worker/status`);
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
