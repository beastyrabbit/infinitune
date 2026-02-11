import type { Id } from "../../convex/_generated/dataModel";

export function asPlaylistId(id: string): Id<"playlists"> {
	return id as Id<"playlists">;
}

export function asSongId(id: string): Id<"songs"> {
	return id as Id<"songs">;
}
