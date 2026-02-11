import { useQuery } from "convex/react";
import type { Id } from "@/types/convex";
import { api } from "../../convex/_generated/api";

export type OneshotPhase =
	| "idle"
	| "creating"
	| "generating"
	| "ready"
	| "error";

export function useOneshot(playlistId: Id<"playlists"> | null) {
	const songs = useQuery(
		api.songs.getQueue,
		playlistId ? { playlistId } : "skip",
	);
	const playlist = useQuery(
		api.playlists.get,
		playlistId ? { id: playlistId } : "skip",
	);

	if (!playlistId || !songs) {
		return {
			song: null,
			playlist: playlist ?? null,
			phase: "idle" as OneshotPhase,
		};
	}

	const song = songs[0] ?? null;

	let phase: OneshotPhase = "idle";
	if (!song) {
		// Playlist created but no song yet
		phase = "creating";
	} else if (song.status === "error") {
		phase = "error";
	} else if (song.status === "ready" || song.status === "played") {
		phase = "ready";
	} else {
		phase = "generating";
	}

	return { song, playlist: playlist ?? null, phase };
}
