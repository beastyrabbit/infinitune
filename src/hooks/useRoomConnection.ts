import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ClientMessage,
	CommandAction,
	Device,
	DeviceRole,
	PlaybackState,
	ServerMessage,
	SongData,
} from "../../room-server/protocol";

const ROOM_SERVER_URL =
	typeof window !== "undefined"
		? `ws://${window.location.hostname}:5174`
		: "ws://localhost:5174";

const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30_000;

export interface RoomConnection {
	playback: PlaybackState;
	currentSong: SongData | null;
	queue: SongData[];
	devices: Device[];
	connected: boolean;
	sendCommand: (
		action: CommandAction,
		payload?: Record<string, unknown>,
		targetDeviceId?: string,
	) => void;
	sendSync: (
		currentSongId: string | null,
		isPlaying: boolean,
		currentTime: number,
		duration: number,
	) => void;
	sendSongEnded: () => void;
	setRole: (role: DeviceRole) => void;
	renameDevice: (targetDeviceId: string, name: string) => void;
	serverTimeOffset: number;
}

function generateDeviceId(): string {
	const stored = sessionStorage.getItem("infinitune-device-id");
	if (stored) return stored;
	const id = `device-${Math.random().toString(36).slice(2, 10)}`;
	sessionStorage.setItem("infinitune-device-id", id);
	return id;
}

export function useRoomConnection(
	roomId: string | null,
	deviceName: string,
	role: DeviceRole,
	playlistKey?: string,
	roomName?: string,
): RoomConnection {
	const [playback, setPlayback] = useState<PlaybackState>({
		currentSongId: null,
		isPlaying: false,
		currentTime: 0,
		duration: 0,
		volume: 0.8,
		isMuted: false,
	});
	const [currentSong, setCurrentSong] = useState<SongData | null>(null);
	const [queue, setQueue] = useState<SongData[]>([]);
	const [devices, setDevices] = useState<Device[]>([]);
	const [connected, setConnected] = useState(false);
	const [serverTimeOffset, setServerTimeOffset] = useState(0);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectDelay = useRef(INITIAL_RECONNECT_DELAY);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const deviceIdRef = useRef<string>("");
	const roleRef = useRef(role);
	const roomIdRef = useRef(roomId);
	const messageHandlersRef = useRef<((msg: ServerMessage) => void)[]>([]);

	// Keep refs up to date
	useEffect(() => {
		roleRef.current = role;
	}, [role]);
	useEffect(() => {
		roomIdRef.current = roomId;
	}, [roomId]);

	const send = useCallback((msg: ClientMessage) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify(msg));
		}
	}, []);

	// Time sync: collect pong responses and compute median offset
	const pingOffsetsRef = useRef<number[]>([]);

	const handleMessage = useCallback((event: MessageEvent) => {
		let msg: ServerMessage;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return;
		}

		switch (msg.type) {
			case "state":
				setPlayback(msg.playback);
				setCurrentSong(msg.currentSong);
				setDevices(msg.devices);
				break;
			case "queue":
				setQueue(msg.songs);
				break;
			case "pong": {
				const now = Date.now();
				const roundTrip = now - msg.clientTime;
				const offset = msg.serverTime - msg.clientTime - roundTrip / 2;
				pingOffsetsRef.current.push(offset);
				if (pingOffsetsRef.current.length >= 3) {
					const sorted = [...pingOffsetsRef.current].sort((a, b) => a - b);
					const median = sorted[Math.floor(sorted.length / 2)];
					setServerTimeOffset(median);
				}
				break;
			}
			case "error":
				console.error("[room-ws] Server error:", msg.message);
				break;
		}

		// Forward to registered handlers (useRoomPlayer listens here)
		for (const handler of messageHandlersRef.current) {
			handler(msg);
		}
	}, []);

	const connect = useCallback(() => {
		if (!roomIdRef.current) return;

		if (typeof window === "undefined") return;
		if (!deviceIdRef.current) {
			deviceIdRef.current = generateDeviceId();
		}

		const ws = new WebSocket(ROOM_SERVER_URL);
		wsRef.current = ws;

		ws.addEventListener("open", () => {
			setConnected(true);
			reconnectDelay.current = INITIAL_RECONNECT_DELAY;

			// Join room
			const currentRoomId = roomIdRef.current;
			if (!currentRoomId) return;
			send({
				type: "join",
				roomId: currentRoomId,
				deviceId: deviceIdRef.current,
				deviceName,
				role: roleRef.current,
				playlistKey: playlistKey || undefined,
				roomName: roomName || undefined,
			});

			// Start time sync pings
			pingOffsetsRef.current = [];
			for (let i = 0; i < 5; i++) {
				setTimeout(() => {
					send({ type: "ping", clientTime: Date.now() });
				}, i * 200);
			}
		});

		ws.addEventListener("message", handleMessage);

		ws.addEventListener("close", () => {
			setConnected(false);
			wsRef.current = null;
			// Exponential backoff reconnect
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
			reconnectTimer.current = setTimeout(() => {
				connect();
			}, reconnectDelay.current);
			reconnectDelay.current = Math.min(
				reconnectDelay.current * 2,
				MAX_RECONNECT_DELAY,
			);
		});

		ws.addEventListener("error", () => {
			// Close event will handle reconnect
		});
	}, [deviceName, handleMessage, send, playlistKey, roomName]);

	// Connect/disconnect when roomId changes
	useEffect(() => {
		if (!roomId) return;
		connect();
		return () => {
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [roomId, connect]);

	// Re-send role when it changes
	useEffect(() => {
		if (connected && roomId) {
			send({ type: "setRole", role });
		}
	}, [role, connected, roomId, send]);

	const sendCommand = useCallback(
		(
			action: CommandAction,
			payload?: Record<string, unknown>,
			targetDeviceId?: string,
		) => {
			send({ type: "command", action, payload, targetDeviceId });
		},
		[send],
	);

	const renameDeviceFn = useCallback(
		(targetDeviceId: string, name: string) => {
			send({ type: "renameDevice", targetDeviceId, name });
		},
		[send],
	);

	const sendSync = useCallback(
		(
			currentSongId: string | null,
			isPlaying: boolean,
			currentTime: number,
			duration: number,
		) => {
			send({ type: "sync", currentSongId, isPlaying, currentTime, duration });
		},
		[send],
	);

	const sendSongEnded = useCallback(() => {
		send({ type: "songEnded" });
	}, [send]);

	const setRoleFn = useCallback(
		(newRole: DeviceRole) => {
			send({ type: "setRole", role: newRole });
		},
		[send],
	);

	// Expose a way for useRoomPlayer to register message handlers
	const addMessageHandler = useCallback(
		(handler: (msg: ServerMessage) => void) => {
			messageHandlersRef.current.push(handler);
			return () => {
				messageHandlersRef.current = messageHandlersRef.current.filter(
					(h) => h !== handler,
				);
			};
		},
		[],
	);

	// Attach addMessageHandler to the returned object via a ref hack
	// so useRoomPlayer can access it without prop drilling
	const connectionRef = useRef({
		addMessageHandler,
	});
	connectionRef.current.addMessageHandler = addMessageHandler;

	// Export the ref for external access
	(sendCommand as unknown as Record<string, unknown>).__connectionRef =
		connectionRef;

	return {
		playback,
		currentSong,
		queue,
		devices,
		connected,
		sendCommand,
		sendSync,
		sendSongEnded,
		setRole: setRoleFn,
		renameDevice: renameDeviceFn,
		serverTimeOffset,
	};
}

/** Extract the addMessageHandler from a RoomConnection. */
export function getMessageHandler(
	connection: RoomConnection,
): (handler: (msg: ServerMessage) => void) => () => void {
	return (
		(connection.sendCommand as unknown as Record<string, unknown>)
			.__connectionRef as React.RefObject<{
			addMessageHandler: (handler: (msg: ServerMessage) => void) => () => void;
		}>
	).current.addMessageHandler;
}
