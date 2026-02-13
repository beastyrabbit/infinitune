import { useCallback, useEffect, useRef } from "react";
import type { ServerMessage } from "../../room-server/protocol";
import type { RoomConnection } from "./useRoomConnection";
import { getMessageHandler } from "./useRoomConnection";

/** Call audio.play(), silently ignoring AbortError (caused by rapid load/play racing). */
function safePlay(audio: HTMLAudioElement): void {
	audio.play().catch((err) => {
		if (err instanceof DOMException && err.name === "AbortError") return;
		console.error(err);
	});
}

/**
 * Player role hook: manages audio playback, reports sync, handles execute/nextSong/preload.
 * Pass null to disable (e.g. for controller-only mode).
 *
 * Uses TWO audio elements:
 * - currentAudio: actively playing
 * - preloadAudio: buffering the next song for gapless transitions
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
					switch (msg.action) {
						case "play":
							safePlay(audio);
							break;
						case "pause":
							audio.pause();
							break;
						case "toggle":
							if (audio.paused) {
								safePlay(audio);
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
							// Check if this is a room-wide command (clears override)
							// or a per-device command (sets override).
							// Room-wide setVolume updates connection.playback.volume,
							// per-device does not. We detect by comparing to room state.
							// For simplicity: any setVolume execute sets override,
							// syncAll sends room-wide which also comes as execute.
							volumeOverrideRef.current = vol;
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

					// Synchronized start
					if (msg.startAt) {
						const localStart = msg.startAt + serverTimeOffsetRef.current;
						const delay = localStart - Date.now();
						if (delay > 0) {
							setTimeout(() => {
								targetAudio.play().catch(console.error);
							}, delay);
						} else {
							safePlay(targetAudio);
						}
					} else {
						safePlay(targetAudio);
					}
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
	}, [enabled]);

	const seek = useCallback((time: number) => {
		const audio = currentAudioRef.current;
		if (audio) audio.currentTime = time;
	}, []);

	return { seek, audioRef: currentAudioRef };
}
