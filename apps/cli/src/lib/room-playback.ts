import { setTimeout as sleep } from "node:timers/promises";
import type { DaemonAction, IpcResponse } from "./ipc";

type DaemonRequestSender = (
	action: DaemonAction,
	payload?: Record<string, unknown>,
) => Promise<IpcResponse>;

const DEFAULT_JOIN_CHECK_ATTEMPTS = 50;
const DEFAULT_JOIN_CHECK_INTERVAL_MS = 120;

type PlayInRoomSessionOptions = {
	serverUrl: string;
	deviceName: string;
	roomId: string;
	playlistKey?: string;
	roomName?: string;
	expectedPlaylistKey?: string;
	connected: boolean;
	joinCheckAttempts?: number;
	joinCheckIntervalMs?: number;
};

type RoomPlaybackErrorCode = "stale_room_session";
type RoomPlaybackError = Error & { code?: RoomPlaybackErrorCode };

const STALE_ROOM_SESSION_CODE: RoomPlaybackErrorCode = "stale_room_session";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function requireOk(
	action: DaemonAction,
	response: IpcResponse,
): Record<string, unknown> | null {
	if (!response.ok) {
		throw new Error(response.error ?? `Daemon ${action} request failed`);
	}
	return asRecord(response.data);
}

function readRoomStatus(data: unknown): {
	connected: boolean;
	roomId: string | null;
	playlistKey: string | null;
} {
	const payload = asRecord(data);
	if (!payload) {
		return { connected: false, roomId: null, playlistKey: null };
	}
	const roomId =
		typeof payload.roomId === "string" && payload.roomId.length > 0
			? payload.roomId
			: null;
	const playlistKey =
		typeof payload.playlistKey === "string" && payload.playlistKey.length > 0
			? payload.playlistKey
			: null;
	return {
		connected: payload.connected === true,
		roomId,
		playlistKey,
	};
}

export function isConnectedFlag(value: unknown): boolean {
	return value === true;
}

export function isStaleRoomPlaybackError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const maybeCode = (error as { code?: unknown }).code;
	return maybeCode === STALE_ROOM_SESSION_CODE;
}

function annotateStaleRoomError(error: unknown): Error {
	const nextError =
		error instanceof Error ? error : new Error(toErrorMessage(error));
	(nextError as RoomPlaybackError).code = STALE_ROOM_SESSION_CODE;
	return nextError;
}

function isMissingRoomSessionError(error: unknown): boolean {
	const message = toErrorMessage(error).toLowerCase();
	if (message.includes("did not reconnect to room")) return true;
	if (message.includes("unknown room")) return true;
	if (message.includes("not found") && message.includes("room")) return true;
	if (message.includes("not found") && message.includes("session")) return true;
	return false;
}

export async function waitForRoomJoin(
	sendRequest: DaemonRequestSender,
	expectedRoomId: string,
	joinCheckAttempts = DEFAULT_JOIN_CHECK_ATTEMPTS,
	joinCheckIntervalMs = DEFAULT_JOIN_CHECK_INTERVAL_MS,
	expectedPlaylistKey?: string,
): Promise<void> {
	let lastConnectionState: {
		connected: boolean;
		roomId: string | null;
		playlistKey: string | null;
	} | null = null;
	let lastStatusError: string | null = null;
	for (let attempt = 0; attempt < joinCheckAttempts; attempt += 1) {
		try {
			const statusPayload = requireOk("status", await sendRequest("status"));
			const connectionState = readRoomStatus(statusPayload);
			lastConnectionState = connectionState;
			if (
				connectionState.connected &&
				(connectionState.roomId === expectedRoomId ||
					(Boolean(expectedPlaylistKey) &&
						connectionState.playlistKey === expectedPlaylistKey))
			) {
				return;
			}
		} catch (error) {
			lastStatusError = toErrorMessage(error);
		}
		if (attempt < joinCheckAttempts - 1) {
			await sleep(joinCheckIntervalMs);
		}
	}
	const lastObserved = lastConnectionState
		? ` Last observed connected=${String(lastConnectionState.connected)} roomId=${lastConnectionState.roomId ?? "-"} playlistKey=${lastConnectionState.playlistKey ?? "-"}.`
		: "";
	const lastError = lastStatusError
		? ` Last status error: ${lastStatusError}.`
		: "";
	throw new Error(
		`Daemon did not reconnect to room ${expectedRoomId}.${lastObserved}${lastError}`,
	);
}

function isReconnectablePlayError(error: unknown): boolean {
	const message = toErrorMessage(error).toLowerCase();
	return (
		message.includes("not connected") ||
		message.includes("not joined") ||
		message.includes("connectionstate=")
	);
}

async function reconnectToRoom(
	sendRequest: DaemonRequestSender,
	options: PlayInRoomSessionOptions,
): Promise<void> {
	try {
		requireOk(
			"joinRoom",
			await sendRequest("joinRoom", {
				serverUrl: options.serverUrl,
				roomId: options.roomId,
				playlistKey: options.playlistKey ?? undefined,
				roomName: options.roomName ?? undefined,
				deviceName: options.deviceName,
			}),
		);
	} catch (error) {
		if (isMissingRoomSessionError(error)) {
			throw annotateStaleRoomError(error);
		}
		throw error;
	}

	await waitForRoomJoin(
		sendRequest,
		options.roomId,
		options.joinCheckAttempts,
		options.joinCheckIntervalMs,
		options.expectedPlaylistKey,
	);
}

export async function playInRoomSession(
	sendRequest: DaemonRequestSender,
	options: PlayInRoomSessionOptions,
): Promise<void> {
	const expectedRoomId = options.roomId;
	let initialStateIsValid: {
		connected: boolean;
		roomId: string | null;
		playlistKey: string | null;
	} | null = null;
	if (options.connected) {
		try {
			initialStateIsValid = readRoomStatus(
				requireOk("status", await sendRequest("status")),
			);
		} catch {
			initialStateIsValid = null;
		}
	}
	const shouldReconnect =
		!initialStateIsValid ||
		!initialStateIsValid.connected ||
		(initialStateIsValid.roomId !== expectedRoomId &&
			(!options.expectedPlaylistKey ||
				initialStateIsValid.playlistKey !== options.expectedPlaylistKey));
	if (shouldReconnect) {
		await reconnectToRoom(sendRequest, options);
	}

	try {
		requireOk("play", await sendRequest("play"));
	} catch (error) {
		if (!isReconnectablePlayError(error)) {
			throw error;
		}
		await reconnectToRoom(sendRequest, options);
		requireOk("play", await sendRequest("play"));
	}
}
