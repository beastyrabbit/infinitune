import { useMutation } from "convex/react";
import { useEffect } from "react";
import type { Id, Playlist, Song } from "@/types/convex";
import { api } from "../../convex/_generated/api";

/**
 * Manages playlist lifecycle side-effects:
 * - Updates the playlist's current playback position (for buffer calculation).
 * - Auto-closes playlists when all transient songs have finished.
 */
export function usePlaylistLifecycle(
	playlistId: Id<"playlists"> | null,
	playlist: Playlist | null | undefined,
	songs: Song[] | undefined,
	currentSongId: string | null,
) {
	const updateCurrentPosition = useMutation(
		api.playlists.updateCurrentPosition,
	);
	const updatePlaylistStatus = useMutation(api.playlists.updateStatus);

	// Update playlist's current position when song changes
	useEffect(() => {
		if (!currentSongId || !songs || !playlistId) return;
		const song = songs.find((s) => s._id === currentSongId);
		if (song) {
			updateCurrentPosition({
				id: playlistId,
				currentOrderIndex: song.orderIndex,
			});
		}
	}, [currentSongId, songs, playlistId, updateCurrentPosition]);

	// Auto-close: when playlist is 'closing' and no songs are in transient state
	useEffect(() => {
		if (!playlist || playlist.status !== "closing" || !songs || !playlistId)
			return;

		const transientStatuses = [
			"pending",
			"generating_metadata",
			"metadata_ready",
			"submitting_to_ace",
			"generating_audio",
			"saving",
		];
		const stillActive = songs.some((s) => transientStatuses.includes(s.status));

		if (!stillActive) {
			updatePlaylistStatus({ id: playlistId, status: "closed" });
		}
	}, [playlist, songs, playlistId, updatePlaylistStatus]);
}
