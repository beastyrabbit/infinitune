import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Sends periodic heartbeat to Convex so the worker knows this playlist
 * has active listeners. Cleans up on unmount (no more heartbeats).
 */
export function usePlaylistHeartbeat(playlistId: Id<"playlists"> | null) {
	const updateHeartbeat = useMutation(api.playlists.updateHeartbeat);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (!playlistId) return;

		// Send immediately on mount
		updateHeartbeat({ id: playlistId }).catch(() => {
			// Silently ignore heartbeat failures
		});

		// Then every 30 seconds
		intervalRef.current = setInterval(() => {
			updateHeartbeat({ id: playlistId }).catch(() => {});
		}, HEARTBEAT_INTERVAL_MS);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [playlistId, updateHeartbeat]);
}
