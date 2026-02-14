import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5175";
const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws`;

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 2000,
			refetchOnWindowFocus: true,
		},
	},
});

export { queryClient };

/**
 * Connects to the API server's WebSocket bridge and invalidates
 * relevant React Query keys when events arrive.
 */
function useWsInvalidation() {
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		let ws: WebSocket;
		let reconnectTimer: ReturnType<typeof setTimeout>;

		function connect() {
			ws = new WebSocket(WS_URL);
			wsRef.current = ws;

			ws.onmessage = (event) => {
				let routingKey: string;
				try {
					({ routingKey } = JSON.parse(event.data) as {
						routingKey: string;
						data: unknown;
					});
				} catch {
					// Ignore malformed messages
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
				reconnectTimer = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			clearTimeout(reconnectTimer);
			ws?.close();
		};
	}, []);
}

// useWsInvalidation runs before QueryClientProvider renders, but works because
// queryClient is a module-level singleton imported directly (not via React context).
export default function ApiProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	useWsInvalidation();
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
