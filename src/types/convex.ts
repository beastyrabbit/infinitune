import type { Doc, Id } from "../../convex/_generated/dataModel";

export type { Doc, Id };

// Song with coverUrl resolved from coverStorageId (augmented by getQueue query)
export type Song = Doc<"songs"> & { coverUrl?: string };
export type Session = Doc<"sessions">;
