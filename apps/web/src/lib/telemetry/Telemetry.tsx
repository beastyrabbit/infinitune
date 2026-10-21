import type { TelemetryConfig } from "@infinitune/shared/telemetry";
import { useEffect, useRef } from "react";
import { getGlobalAudio, playerStore } from "@/lib/player-store";
import { startAnalytics, trackEvent } from "./browser";
import { startBrowserSentry } from "./sentry";

export function Telemetry({ config }: { config: TelemetryConfig }) {
	const lastPlayedSong = useRef<string | null>(null);
	useEffect(() => {
		startAnalytics(config);
		const audio = getGlobalAudio();
		const props = () => ({
			song_id: playerStore.state.currentSongId || undefined,
		});
		const play = () => {
			const songId = playerStore.state.currentSongId;
			if (!songId || songId === lastPlayedSong.current) return;
			lastPlayedSong.current = songId;
			trackEvent("song_play", props());
		};
		const complete = () => {
			trackEvent("song_complete", props());
			lastPlayedSong.current = null;
		};
		const subscription = playerStore.subscribe(() => {
			if (playerStore.state.currentSongId !== lastPlayedSong.current)
				lastPlayedSong.current = null;
		});
		const error = () =>
			trackEvent("playback_error", {
				...props(),
				error_class: `MediaError${audio.error?.code || 0}`,
			});
		audio.addEventListener("play", play);
		audio.addEventListener("ended", complete);
		audio.addEventListener("error", error);
		// Leave the first paint free of the SDK's download/initialization work.
		const timer = setTimeout(() => {
			void startBrowserSentry(config);
		}, 100);
		return () => {
			clearTimeout(timer);
			subscription.unsubscribe();
			audio.removeEventListener("play", play);
			audio.removeEventListener("ended", complete);
			audio.removeEventListener("error", error);
		};
	}, [config]);
	return null;
}
