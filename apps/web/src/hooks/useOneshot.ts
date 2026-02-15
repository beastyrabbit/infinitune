import { usePlaylist, useSongQueue } from "@/integrations/api/hooks";

export type OneshotPhase =
	| "idle"
	| "creating"
	| "generating"
	| "ready"
	| "error";

export function useOneshot(playlistId: string | null) {
	const songs = useSongQueue(playlistId);
	const playlist = usePlaylist(playlistId);

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
