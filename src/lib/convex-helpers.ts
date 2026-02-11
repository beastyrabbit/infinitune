import type { Id } from "../../convex/_generated/dataModel";

export function asSessionId(id: string): Id<"sessions"> {
	return id as Id<"sessions">;
}

export function asSongId(id: string): Id<"songs"> {
	return id as Id<"songs">;
}
