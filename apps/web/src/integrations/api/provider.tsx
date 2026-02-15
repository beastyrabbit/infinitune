import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { EVENT_WS_URL } from "@/lib/endpoints";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 2000,
			refetchOnWindowFocus: true,
		},
	},
});

export { queryClient };

const BACKOFF_BASE = 1000;
const BACKOFF_CAP = 30_000;
const JITTER_MS = 500;

function getBackoffDelay(attempt: number): number {
	const exponential = Math.min(BACKOFF_BASE * 2 ** attempt, BACKOFF_CAP);
	const jitter = (Math.random() - 0.5) * 2 * JITTER_MS;
	return Math.max(0, exponential + jitter);
}

/**
 * Connects to the API server's WebSocket bridge and invalidates
 * relevant React Query keys when events arrive.
 */
function useWsInvalidation() {
	const wsRef = useRef<WebSocket | null>(null);
	const [connected, setConnected] = useState(false);
	const attemptRef = useRef(0);

	useEffect(() => {
		let ws: WebSocket;
		let reconnectTimer: ReturnType<typeof setTimeout>;
		let disposed = false;

		function connect() {
			if (disposed) return;
			ws = new WebSocket(EVENT_WS_URL);
			wsRef.current = ws;

			ws.onopen = () => {
				attemptRef.current = 0;
				setConnected(true);
			};

			ws.onmessage = (event) => {
				let routingKey: string;
				try {
					({ routingKey } = JSON.parse(event.data) as {
						routingKey: string;
						data: unknown;
					});
				} catch {
					return;
				}
				if (routingKey.startsWith("songs.")) {
					const playlistId = routingKey.replace("songs.", "");
					queryClient.invalidateQueries({
						queryKey: ["songs", "queue", playlistId],
					});
					queryClient.invalidateQueries({
						queryKey: ["songs", "by-playlist", playlistId],
					});
					queryClient.invalidateQueries({
						queryKey: ["songs", "all"],
					});
				} else if (routingKey === "playlists") {
					queryClient.invalidateQueries({
						queryKey: ["playlists"],
					});
				} else if (routingKey === "settings") {
					queryClient.invalidateQueries({
						queryKey: ["settings"],
					});
				}
			};

			ws.onclose = () => {
				wsRef.current = null;
				setConnected(false);
				if (!disposed) {
					const delay = getBackoffDelay(attemptRef.current);
					attemptRef.current++;
					reconnectTimer = setTimeout(connect, delay);
				}
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			disposed = true;
			clearTimeout(reconnectTimer);
			ws?.close();
		};
	}, []);

	return connected;
}

export default function ApiProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const connected = useWsInvalidation();
	return (
		<QueryClientProvider client={queryClient}>
			{!connected && (
				<div className="fixed top-0 inset-x-0 z-50 bg-yellow-600/90 text-black text-center text-xs font-medium py-1">
					Reconnecting to server...
				</div>
			)}
			{children}
		</QueryClientProvider>
	);
}
