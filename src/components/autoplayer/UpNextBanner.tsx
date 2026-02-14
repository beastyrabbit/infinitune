import { findGeneratingInterrupt, pickNextSong } from "@/lib/pick-next-song";
import type { Playlist, Song } from "@/types";

interface UpNextBannerProps {
	songs: Song[];
	currentSongId: string | null;
	playlist: Playlist;
	transitionComplete: boolean;
}

export function UpNextBanner({
	songs,
	currentSongId,
	playlist,
	transitionComplete,
}: UpNextBannerProps) {
	const playlistEpoch = playlist.promptEpoch ?? 0;
	const currentSong = currentSongId
		? songs.find((s) => s._id === currentSongId)
		: null;
	const nextSong = pickNextSong(
		songs,
		currentSongId,
		playlistEpoch,
		currentSong?.orderIndex,
	);
	const generatingInterrupt = findGeneratingInterrupt(songs);

	// Generating interrupt takes display priority over next ready song
	if (generatingInterrupt) {
		const title = generatingInterrupt.title
			? `"${generatingInterrupt.title.toUpperCase()}"`
			: `"${(generatingInterrupt.interruptPrompt ?? "YOUR REQUEST").toUpperCase()}"`;

		return (
			<div className="border-y-4 border-yellow-500/60 bg-black px-4 py-2 animate-pulse">
				<p className="text-center text-sm font-black uppercase tracking-widest text-yellow-500">
					{">>> UP NEXT: YOUR REQUEST — "}
					{title}
					{" [GENERATING...] — WILL PLAY WHEN READY <<<"}
				</p>
			</div>
		);
	}

	if (!nextSong) return null;

	const isInterrupt = nextSong.isInterrupt;
	const isCurrentEpoch = (nextSong.promptEpoch ?? 0) === playlistEpoch;
	const isFiller = !transitionComplete && !isCurrentEpoch && playlistEpoch > 0;
	const title = `"${(nextSong.title ?? "UNKNOWN").toUpperCase()}"`;

	if (isInterrupt) {
		return (
			<div className="border-y-4 border-green-500/60 bg-black px-4 py-2">
				<p className="text-center text-sm font-black uppercase tracking-widest text-green-400">
					{">>> UP NEXT: YOUR REQUEST — "}
					{title}
					{" [READY] <<<"}
				</p>
			</div>
		);
	}

	if (isFiller) {
		return (
			<div className="border-y-4 border-white/10 bg-black px-4 py-2">
				<p className="text-center text-sm font-black uppercase tracking-widest text-white/30">
					{">>> WAITING FOR NEW DIRECTION — PLAYING FILLER: "}
					{title}
					{" <<<"}
				</p>
			</div>
		);
	}

	const label =
		playlistEpoch > 0 && isCurrentEpoch ? " [NEW DIRECTION]" : " [READY]";

	return (
		<div className="border-y-4 border-white/10 bg-black px-4 py-2">
			<p className="text-center text-sm font-black uppercase tracking-widest text-white/60">
				{">>> UP NEXT: "}
				{title}
				{label}
				{" <<<"}
			</p>
		</div>
	);
}
