import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "../../room-server/protocol";
import type { RoomConnection } from "./useRoomConnection";
import { getMessageHandler } from "./useRoomConnection";

/**
 * Call audio.play(), returning true if playback started.
 * Silently ignores AbortError (caused by rapid load/play racing).
 * Returns false if blocked by autoplay policy (NotAllowedError).
 */
function tryPlay(audio: HTMLAudioElement): Promise<boolean> {
	return audio.play().then(
		() => true,
		(err) => {
			if (err instanceof DOMException) {
				if (err.name === "AbortError") return true; // rapid race, not a real failure
				if (err.name === "NotAllowedError") return false; // autoplay blocked
			}
			console.error(err);
			return false;
		},
	);
}

/**
 * Player role hook: manages audio playback, reports sync, handles execute/nextSong/preload.
 * Pass null to disable (e.g. for controller-only mode).
 *
 * Uses TWO audio elements:
 * - currentAudio: actively playing
 * - preloadAudio: buffering the next song for gapless transitions
 *
 * Autoplay unlock: browsers block audio.play() from non-gesture contexts (WebSocket handlers).
 * When play is blocked, we queue it as "pending" and retry on the first user click/touch.
 *
 * IMPORTANT: Uses refs for the connection to avoid effect re-runs on every state change.
 * The connection object is a new reference every render, so we store it in a ref and
 * only key effects on whether connection is null/non-null (via a stable `enabled` boolean).
 */
export function useRoomPlayer(connection: RoomConnection | null) {
	const currentAudioRef = useRef<HTMLAudioElement | null>(null);
	const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
	const preloadSongIdRef = useRef<string | null>(null);
	const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const serverTimeOffsetRef = useRef(0);

	// Track per-device volume override (set by targeted setVolume commands).
	// When non-null, room-wide volume sync is skipped. Cleared by room-wide setVolume.
	const volumeOverrideRef = useRef<number | null>(null);

	// Autoplay unlock: true once audio.play() has succeeded from a user gesture
	const audioUnlockedRef = useRef(false);
	const pendingPlayRef = useRef(false);
	const [needsUnlock, setNeedsUnlock] = useState(false);

	// Store connection in a ref so callbacks always read the latest without re-running effects
	const connectionRef = useRef(connection);
	connectionRef.current = connection;

	// Stable boolean: is the player enabled?
	const enabled = connection !== null;

	// Keep offset ref in sync
	useEffect(() => {
		if (connection) {
			serverTimeOffsetRef.current = connection.serverTimeOffset;
		}
	}, [connection?.serverTimeOffset, connection]);

	// Volume sync from room state — only applies when no per-device override is active
	useEffect(() => {
		if (!connection) return;
		if (volumeOverrideRef.current !== null) return;
		const audio = currentAudioRef.current;
		if (!audio) return;
		audio.volume = connection.playback.isMuted ? 0 : connection.playback.volume;
	}, [connection, connection?.playback.volume, connection?.playback.isMuted]);

	/**
	 * Attempt to play the current audio element. If blocked by autoplay policy,
	 * mark as pending so the user-gesture handler can retry.
	 */
	const attemptPlay = useCallback(
		async (audio: HTMLAudioElement, startAt?: number) => {
			const doPlay = async () => {
				const ok = await tryPlay(audio);
				if (ok) {
					audioUnlockedRef.current = true;
					pendingPlayRef.current = false;
					setNeedsUnlock(false);
				} else {
					pendingPlayRef.current = true;
					setNeedsUnlock(true);
				}
			};

			if (startAt) {
				const localStart = startAt + serverTimeOffsetRef.current;
				const delay = localStart - Date.now();
				if (delay > 0) {
					setTimeout(doPlay, delay);
				} else {
					doPlay();
				}
			} else {
				doPlay();
			}
		},
		[],
	);

	// Autoplay unlock: listen for first user gesture to retry pending play
	useEffect(() => {
		if (!enabled) return;

		const handleGesture = () => {
			audioUnlockedRef.current = true;
			const audio = currentAudioRef.current;
			if (audio?.src && pendingPlayRef.current) {
				pendingPlayRef.current = false;
				setNeedsUnlock(false);
				tryPlay(audio);
			}
		};

		document.addEventListener("click", handleGesture, { once: true });
		document.addEventListener("touchstart", handleGesture, { once: true });
		document.addEventListener("keydown", handleGesture, { once: true });
		return () => {
			document.removeEventListener("click", handleGesture);
			document.removeEventListener("touchstart", handleGesture);
			document.removeEventListener("keydown", handleGesture);
		};
	}, [enabled]);

	// Initialize audio elements + sync interval — only runs when enabled toggles
	useEffect(() => {
		if (!enabled) return;
		if (typeof window === "undefined") return;

		if (!currentAudioRef.current) {
			currentAudioRef.current = new Audio();
		}
		if (!preloadAudioRef.current) {
			preloadAudioRef.current = new Audio();
		}

		const audio = currentAudioRef.current;

		const handleEnded = () => {
			connectionRef.current?.sendSongEnded();
		};

		audio.addEventListener("ended", handleEnded);

		// Start sync reporting (every 1s)
		syncIntervalRef.current = setInterval(() => {
			const conn = connectionRef.current;
			if (audio && !audio.paused && audio.src && conn) {
				conn.sendSync(
					conn.playback.currentSongId,
					!audio.paused,
					audio.currentTime,
					audio.duration || 0,
				);
			}
		}, 1000);

		return () => {
			audio.removeEventListener("ended", handleEnded);
			if (syncIntervalRef.current) {
				clearInterval(syncIntervalRef.current);
			}
			audio.pause();
			audio.src = "";
			if (preloadAudioRef.current) {
				preloadAudioRef.current.src = "";
			}
		};
	}, [enabled]);

	// Handle server messages (execute, nextSong, preload) — only runs when enabled toggles
	useEffect(() => {
		if (!enabled) return;
		const conn = connectionRef.current;
		if (!conn) return;

		const removeHandler = getMessageHandler(conn)((msg: ServerMessage) => {
			const audio = currentAudioRef.current;
			if (!audio) return;
			const liveConn = connectionRef.current;

			switch (msg.type) {
				case "execute": {
					const scope = msg.scope ?? "room";
					switch (msg.action) {
						case "play":
							attemptPlay(audio);
							break;
						case "pause":
							audio.pause();
							break;
						case "toggle":
							if (audio.paused) {
								attemptPlay(audio);
							} else {
								audio.pause();
							}
							break;
						case "seek": {
							const time = (msg.payload?.time as number) ?? 0;
							audio.currentTime = time;
							break;
						}
						case "setVolume": {
							const vol = (msg.payload?.volume as number) ?? 0.8;
							audio.volume = vol;
							// Room-wide setVolume clears per-device override;
							// device-scoped setVolume sets the override.
							if (scope === "room") {
								volumeOverrideRef.current = null;
							} else {
								volumeOverrideRef.current = vol;
							}
							break;
						}
						case "toggleMute":
							audio.muted = !audio.muted;
							break;
					}
					break;
				}

				case "nextSong": {
					const preload = preloadAudioRef.current;
					// Check if we already preloaded this song
					if (
						preload &&
						preloadSongIdRef.current === msg.songId &&
						preload.src
					) {
						// Swap preloaded audio to current
						const oldAudio = currentAudioRef.current;
						if (oldAudio) {
							oldAudio.pause();
							oldAudio.src = "";
						}

						currentAudioRef.current = preload;
						preloadAudioRef.current = oldAudio ?? new Audio();
						preloadSongIdRef.current = null;
					} else {
						// Load fresh
						audio.src = msg.audioUrl;
						audio.load();
					}

					const targetAudio = currentAudioRef.current;
					if (!targetAudio) break;

					// Apply volume: use per-device override if set, otherwise room-wide
					if (volumeOverrideRef.current !== null) {
						targetAudio.volume = volumeOverrideRef.current;
					} else {
						targetAudio.volume = liveConn?.playback.isMuted
							? 0
							: (liveConn?.playback.volume ?? 0.8);
					}

					// Re-register ended listener on swapped audio
					const handleEnded = () => {
						connectionRef.current?.sendSongEnded();
					};
					targetAudio.addEventListener("ended", handleEnded, {
						once: true,
					});

					// Attempt synchronized start
					attemptPlay(targetAudio, msg.startAt);
					break;
				}

				case "preload": {
					const preload = preloadAudioRef.current;
					if (!preload) break;
					preloadSongIdRef.current = msg.songId;
					preload.src = msg.audioUrl;
					preload.load(); // Buffer but don't play
					break;
				}
			}
		});

		return removeHandler;
	}, [enabled, attemptPlay]);

	const seek = useCallback((time: number) => {
		const audio = currentAudioRef.current;
		if (audio) audio.currentTime = time;
	}, []);

	return { seek, audioRef: currentAudioRef, needsUnlock };
}
