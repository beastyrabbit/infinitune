// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTabListenerId,
	RADIO_LISTENER_STORAGE_KEY,
	rejoinActiveListener,
	useRadioSocket,
} from "../lib/radio-socket";

class FakeWebSocket {
	static readonly OPEN = 1;
	static instances: FakeWebSocket[] = [];

	readonly send = vi.fn();
	readyState = FakeWebSocket.OPEN;
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(readonly url: string) {
		FakeWebSocket.instances.push(this);
	}

	close() {
		this.readyState = 3;
		this.onclose?.();
	}
}

describe("radio WebSocket reconnect", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeWebSocket.instances = [];
		window.localStorage.clear();
		window.sessionStorage.clear();
		vi.stubGlobal("WebSocket", FakeWebSocket);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("rejoins through REST after a playing client's socket reconnects", async () => {
		const rejoinRef = { current: false };
		const onRejoin = vi.fn().mockResolvedValue(undefined);
		renderHook(() =>
			useRadioSocket("listener-1", vi.fn(), rejoinRef, onRejoin),
		);

		expect(FakeWebSocket.instances).toHaveLength(1);
		act(() => FakeWebSocket.instances[0]?.onopen?.());
		expect(onRejoin).not.toHaveBeenCalled();

		rejoinRef.current = true;
		act(() => FakeWebSocket.instances[0]?.onclose?.());
		await act(async () => vi.advanceTimersByTime(1_500));
		expect(FakeWebSocket.instances).toHaveLength(2);

		act(() => FakeWebSocket.instances[1]?.onopen?.());
		expect(onRejoin).toHaveBeenCalledOnce();
	});

	it("retries a failed rejoin while the reopened socket stays connected", async () => {
		const rejoinRef = { current: true };
		const onRejoin = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary failure"))
			.mockResolvedValue(undefined);
		renderHook(() =>
			useRadioSocket("listener-1", vi.fn(), rejoinRef, onRejoin),
		);

		act(() => FakeWebSocket.instances[0]?.onopen?.());
		await act(async () => Promise.resolve());
		expect(onRejoin).toHaveBeenCalledTimes(1);

		await act(async () => vi.advanceTimersByTimeAsync(1_500));

		expect(onRejoin).toHaveBeenCalledTimes(2);
		expect(rejoinRef.current).toBe(true);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it("cancels a pending rejoin retry when playback is paused", async () => {
		const rejoinRef = { current: true };
		const onRejoin = vi.fn().mockRejectedValue(new Error("temporary failure"));
		const { result } = renderHook(() =>
			useRadioSocket("listener-1", vi.fn(), rejoinRef, onRejoin),
		);

		act(() => FakeWebSocket.instances[0]?.onopen?.());
		await act(async () => Promise.resolve());
		act(() => result.current.cancelRejoin());
		await act(async () => vi.advanceTimersByTimeAsync(30_000));

		expect(onRejoin).toHaveBeenCalledOnce();
		expect(rejoinRef.current).toBe(false);
	});

	it("compensates when playback is paused during an in-flight rejoin", async () => {
		let resolvePlay: ((value: { station: string }) => void) | undefined;
		const play = vi.fn(
			() =>
				new Promise<{ station: string }>((resolve) => {
					resolvePlay = resolve;
				}),
		);
		const pause = vi.fn().mockResolvedValue(undefined);
		const rejoinRef = { current: true };

		const rejoin = rejoinActiveListener("listener-1", rejoinRef, play, pause);
		rejoinRef.current = false;
		resolvePlay?.({ station: "playing" });

		await expect(rejoin).resolves.toBeUndefined();
		expect(pause).toHaveBeenCalledOnce();
		expect(pause).toHaveBeenCalledWith({ listenerId: "listener-1" });
	});

	it("uses one stable listener id per tab session", () => {
		function storage() {
			const values = new Map<string, string>();
			return {
				getItem: (key: string) => values.get(key) ?? null,
				setItem: (key: string, value: string) => values.set(key, value),
			};
		}
		const firstTab = storage();
		const secondTab = storage();
		window.localStorage.setItem(RADIO_LISTENER_STORAGE_KEY, "legacy-shared-id");

		const firstId = getTabListenerId(firstTab);
		expect(getTabListenerId(firstTab)).toBe(firstId);
		expect(getTabListenerId(secondTab)).not.toBe(firstId);
		const defaultId = getTabListenerId();
		expect(defaultId).not.toBe("legacy-shared-id");
		expect(window.sessionStorage.getItem(RADIO_LISTENER_STORAGE_KEY)).toBe(
			defaultId,
		);
	});
});
