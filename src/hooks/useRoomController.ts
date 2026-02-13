import { useCallback } from "react";
import type { RoomConnection } from "./useRoomConnection";

/**
 * Controller role hook: maps room commands to friendly functions.
 * No audio — just sends commands to the room server.
 */
export function useRoomController(connection: RoomConnection) {
	const { sendCommand, renameDevice } = connection;

	const play = useCallback(() => sendCommand("play"), [sendCommand]);
	const pause = useCallback(() => sendCommand("pause"), [sendCommand]);
	const toggle = useCallback(() => sendCommand("toggle"), [sendCommand]);
	const skip = useCallback(() => sendCommand("skip"), [sendCommand]);

	const seek = useCallback(
		(time: number) => sendCommand("seek", { time }),
		[sendCommand],
	);

	const setVolume = useCallback(
		(volume: number) => sendCommand("setVolume", { volume }),
		[sendCommand],
	);

	const toggleMute = useCallback(
		() => sendCommand("toggleMute"),
		[sendCommand],
	);

	const rate = useCallback(
		(songId: string, rating: "up" | "down") =>
			sendCommand("rate", { songId, rating }),
		[sendCommand],
	);

	const selectSong = useCallback(
		(songId: string) => sendCommand("selectSong", { songId }),
		[sendCommand],
	);

	// Per-device targeted commands
	const setDeviceVolume = useCallback(
		(deviceId: string, volume: number) =>
			sendCommand("setVolume", { volume }, deviceId),
		[sendCommand],
	);

	const toggleDevicePlay = useCallback(
		(deviceId: string) => sendCommand("toggle", undefined, deviceId),
		[sendCommand],
	);

	const pauseDevice = useCallback(
		(deviceId: string) => sendCommand("pause", undefined, deviceId),
		[sendCommand],
	);

	const playDevice = useCallback(
		(deviceId: string) => sendCommand("play", undefined, deviceId),
		[sendCommand],
	);

	// Reset all players to room defaults (sync everyone back)
	const syncAll = useCallback(() => {
		sendCommand("setVolume", { volume: connection.playback.volume });
		if (connection.playback.isPlaying) {
			sendCommand("play");
		} else {
			sendCommand("pause");
		}
	}, [sendCommand, connection.playback.volume, connection.playback.isPlaying]);

	return {
		play,
		pause,
		toggle,
		skip,
		seek,
		setVolume,
		toggleMute,
		rate,
		selectSong,
		setDeviceVolume,
		toggleDevicePlay,
		pauseDevice,
		playDevice,
		syncAll,
		renameDevice,
	};
}
