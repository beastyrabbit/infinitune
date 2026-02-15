/**
 * Re-export from the canonical source in src/lib/.
 * Room server's SongData satisfies PickableSong.
 */
export { pickNextSong } from "../src/lib/pick-next-song";
export type { PickableSong } from "../src/lib/pick-next-song";
