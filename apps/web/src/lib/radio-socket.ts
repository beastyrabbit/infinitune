import { useCallback, useEffect, useRef } from "react";
import type { RadioSnapshot } from "@/integrations/api/hooks";
import { RADIO_WS_URL, resolveApiMediaUrl } from "@/lib/endpoints";

export const RADIO_LISTENER_STORAGE_KEY = "infinitune-radio-listener-id";

export function getTabListenerId(
	storage?: Pick<Storage, "getItem" | "setItem">,
): string {
	if (typeof window === "undefined") return "server";
	const tabStorage = storage ?? window.sessionStorage;
	const existing = tabStorage.getItem(RADIO_LISTENER_STORAGE_KEY);
	if (existing) return existing;
	const next = crypto.randomUUID();
	tabStorage.setItem(RADIO_LISTENER_STORAGE_KEY, next);
	return next;
}

export interface RadioRejoinRef {
	current: boolean;
}

export async function rejoinActiveListener<T>(
	listenerId: string,
	rejoinRef: RadioRejoinRef,
	play: (input: { listenerId: string }) => Promise<T>,
	pause: (input: { listenerId: string }) => Promise<unknown>,
): Promise<T | undefined> {
	const snapshot = await play({ listenerId });
	if (!rejoinRef.current) {
		await pause({ listenerId });
		return undefined;
	}
	return snapshot;
}

export function useRadioSocket(
	listenerId: string,
	onSnapshot: (snapshot: RadioSnapshot) => void,
	rejoinRef: RadioRejoinRef,
	onRejoin: () => Promise<void>,
) {
	const wsRef = useRef<WebSocket | null>(null);
	const rejoinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		let disposed = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let rejoinInFlight = false;
		let rejoinFailureCount = 0;

		function clearRejoinTimer() {
			if (rejoinTimerRef.current) clearTimeout(rejoinTimerRef.current);
			rejoinTimerRef.current = null;
		}

		function scheduleRejoin(ws: WebSocket) {
			if (
				disposed ||
				rejoinTimerRef.current ||
				rejoinInFlight ||
				!rejoinRef.current ||
				wsRef.current !== ws ||
				ws.readyState !== WebSocket.OPEN
			) {
				return;
			}
			const delay = Math.min(
				1_500 * 2 ** Math.max(0, rejoinFailureCount - 1),
				30_000,
			);
			rejoinTimerRef.current = setTimeout(() => {
				rejoinTimerRef.current = null;
				void attemptRejoin(ws);
			}, delay);
		}

		async function attemptRejoin(ws: WebSocket) {
			if (
				disposed ||
				rejoinInFlight ||
				!rejoinRef.current ||
				wsRef.current !== ws ||
				ws.readyState !== WebSocket.OPEN
			) {
				return;
			}
			rejoinInFlight = true;
			let failed = false;
			try {
				await onRejoin();
				rejoinFailureCount = 0;
			} catch {
				failed = true;
				rejoinFailureCount++;
			} finally {
				rejoinInFlight = false;
				const currentSocket = wsRef.current;
				if (currentSocket && currentSocket !== ws) {
					void attemptRejoin(currentSocket);
				} else if (failed) {
					scheduleRejoin(ws);
				}
			}
		}

		function connect() {
			if (disposed) return;
			const ws = new WebSocket(RADIO_WS_URL);
			wsRef.current = ws;
			ws.onopen = () => {
				if (rejoinRef.current) void attemptRejoin(ws);
			};
			ws.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data) as Partial<RadioSnapshot> & {
						type?: string;
					};
					if (payload.station && payload.schedule) {
						const currentSong = payload.currentSong
							? {
									...payload.currentSong,
									audioUrl: resolveApiMediaUrl(payload.currentSong.audioUrl),
									cover: payload.currentSong.cover
										? {
												pngUrl: resolveApiMediaUrl(
													payload.currentSong.cover.pngUrl,
												),
												webpUrl: resolveApiMediaUrl(
													payload.currentSong.cover.webpUrl,
												),
												jxlUrl: resolveApiMediaUrl(
													payload.currentSong.cover.jxlUrl,
												),
											}
										: null,
								}
							: null;
						onSnapshot({
							station: payload.station,
							currentSong,
							schedule: payload.schedule.map((item) => ({
								...item,
								audioUrl: resolveApiMediaUrl(item.audioUrl),
							})),
						});
					}
				} catch {
					// Ignore non-state messages.
				}
			};
			ws.onclose = () => {
				clearRejoinTimer();
				wsRef.current = null;
				if (!disposed) reconnectTimer = setTimeout(connect, 1500);
			};
			ws.onerror = () => ws.close();
		}

		connect();
		return () => {
			disposed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			clearRejoinTimer();
			wsRef.current?.close();
		};
	}, [onSnapshot, onRejoin, rejoinRef]);

	const send = useCallback(
		(payload: Record<string, unknown>) => {
			const ws = wsRef.current;
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ listenerId, ...payload }));
				return true;
			}
			return false;
		},
		[listenerId],
	);
	const cancelRejoin = useCallback(() => {
		rejoinRef.current = false;
		if (rejoinTimerRef.current) clearTimeout(rejoinTimerRef.current);
		rejoinTimerRef.current = null;
	}, [rejoinRef]);

	return { cancelRejoin, send };
}
