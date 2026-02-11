import { useQuery } from "convex/react";
import type { Id } from "@/types/convex";
import { api } from "../../convex/_generated/api";

export type OneshotPhase =
	| "idle"
	| "creating"
	| "generating"
	| "ready"
	| "error";

export function useOneshot(sessionId: Id<"sessions"> | null) {
	const songs = useQuery(
		api.songs.getQueue,
		sessionId ? { sessionId } : "skip",
	);
	const session = useQuery(
		api.sessions.get,
		sessionId ? { id: sessionId } : "skip",
	);

	if (!sessionId || !songs) {
		return {
			song: null,
			session: session ?? null,
			phase: "idle" as OneshotPhase,
		};
	}

	const song = songs[0] ?? null;

	let phase: OneshotPhase = "idle";
	if (!song) {
		// Session created but no song yet
		phase = "creating";
	} else if (song.status === "error") {
		phase = "error";
	} else if (song.status === "ready" || song.status === "played") {
		phase = "ready";
	} else {
		phase = "generating";
	}

	return { song, session: session ?? null, phase };
}
