// @vitest-environment jsdom
import {
	type DeviceRole,
	ROOM_PROTOCOL_VERSION,
	ServerMessageSchema,
} from "@infinitune/shared/protocol";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/telemetry/browser";
import { useRoomConnection } from "./useRoomConnection";

vi.mock("@/lib/telemetry/browser", () => ({ trackEvent: vi.fn() }));

class FakeWebSocket extends EventTarget {
	static readonly OPEN = 1;
	static readonly CONNECTING = 0;
	static instances: FakeWebSocket[] = [];
	readyState = FakeWebSocket.CONNECTING;
	send = vi.fn();
	constructor() {
		super();
		FakeWebSocket.instances.push(this);
	}
	open() {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}
	message(message: unknown) {
		this.dispatchEvent(
			new MessageEvent("message", {
				data: JSON.stringify(ServerMessageSchema.parse(message)),
			}),
		);
	}
	ack(roomId = "first", protocolVersion: number = ROOM_PROTOCOL_VERSION) {
		this.message({
			type: "joinAck",
			roomId,
			deviceId: "test-device",
			protocolVersion,
		});
	}
	close() {
		this.readyState = 3;
		this.dispatchEvent(new Event("close"));
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("WebSocket", FakeWebSocket);
	FakeWebSocket.instances = [];
	vi.clearAllMocks();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("counts each room/role once per hook lifetime across reconnects", () => {
	const { rerender, unmount } = renderHook(
		({ room, role }: { room: string; role: DeviceRole }) =>
			useRoomConnection(room, "Test device", role),
		{ initialProps: { room: "first", role: "player" as DeviceRole } },
	);
	expect(trackEvent).not.toHaveBeenCalled();
	act(() => FakeWebSocket.instances[0].open());
	expect(trackEvent).not.toHaveBeenCalled();
	act(() => FakeWebSocket.instances[0].ack());
	expect(trackEvent).toHaveBeenCalledExactlyOnceWith("room_join", {
		role: "player",
	});
	act(() => FakeWebSocket.instances[0].close());
	act(() => vi.advanceTimersByTime(1000));
	act(() => FakeWebSocket.instances[1].open());
	act(() => FakeWebSocket.instances[1].ack());
	act(() => FakeWebSocket.instances[1].ack());
	expect(trackEvent).toHaveBeenCalledTimes(1);
	rerender({ room: "first", role: "controller" });
	expect(trackEvent).toHaveBeenCalledTimes(1);
	act(() => FakeWebSocket.instances[1].close());
	act(() => vi.advanceTimersByTime(1000));
	act(() => FakeWebSocket.instances[2].open());
	act(() => FakeWebSocket.instances[2].ack());
	expect(trackEvent).toHaveBeenCalledTimes(2);
	rerender({ room: "first", role: "player" });
	expect(trackEvent).toHaveBeenCalledTimes(2);
	rerender({ room: "second", role: "player" });
	expect(trackEvent).toHaveBeenCalledTimes(2);
	act(() => FakeWebSocket.instances.at(-1)?.open());
	expect(trackEvent).toHaveBeenCalledTimes(2);
	// A delayed acknowledgement from the old socket cannot count the new room.
	act(() => FakeWebSocket.instances[2].ack());
	expect(trackEvent).toHaveBeenCalledTimes(2);
	act(() => FakeWebSocket.instances.at(-1)?.ack("second"));
	expect(trackEvent).toHaveBeenCalledTimes(3);
	unmount();
	renderHook(() => useRoomConnection("first", "Test device", "player"));
	act(() => FakeWebSocket.instances.at(-1)?.open());
	act(() => FakeWebSocket.instances.at(-1)?.ack());
	expect(trackEvent).toHaveBeenCalledTimes(4);
});

it("does not consume a room/role dedupe key for rejected joins", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	renderHook(() => useRoomConnection("first", "Test device", "player"));
	const socket = FakeWebSocket.instances[0];
	act(() => socket.open());
	act(() => socket.message({ type: "error", message: "Session not found" }));
	expect(trackEvent).not.toHaveBeenCalled();
	act(() => socket.close());
	act(() => vi.advanceTimersByTime(1000));
	const reconnected = FakeWebSocket.instances[1];
	act(() => reconnected.open());
	expect(trackEvent).not.toHaveBeenCalled();
	act(() => reconnected.ack());
	expect(trackEvent).toHaveBeenCalledExactlyOnceWith("room_join", {
		role: "player",
	});
});

it("does not count an acknowledgement with an incompatible protocol", () => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	renderHook(() => useRoomConnection("first", "Test device", "player"));
	const socket = FakeWebSocket.instances[0];
	act(() => socket.open());
	act(() => socket.ack("first", ROOM_PROTOCOL_VERSION + 1));
	expect(trackEvent).not.toHaveBeenCalled();
});

it("tracks room skips only after the command is transmitted", () => {
	const { result, unmount } = renderHook(() =>
		useRoomConnection("room", "Test device", "controller"),
	);
	const socket = FakeWebSocket.instances[0];
	act(() => result.current.sendCommand("skip"));
	expect(socket.send).not.toHaveBeenCalled();
	expect(trackEvent).not.toHaveBeenCalled();

	act(() => socket.open());
	vi.mocked(trackEvent).mockClear();
	socket.send.mockClear();
	act(() => result.current.sendCommand("skip"));
	expect(socket.send).toHaveBeenCalledExactlyOnceWith(
		JSON.stringify({ type: "command", action: "skip" }),
	);
	expect(trackEvent).toHaveBeenCalledExactlyOnceWith("song_skip", {
		source: "room",
	});

	vi.mocked(trackEvent).mockClear();
	socket.send.mockClear();
	act(() => result.current.sendCommand("pause"));
	expect(socket.send).toHaveBeenCalledOnce();
	expect(trackEvent).not.toHaveBeenCalled();

	// CLOSING can precede the close event, while connected still reads true.
	socket.readyState = 2;
	act(() => result.current.sendCommand("skip"));
	expect(trackEvent).not.toHaveBeenCalled();
	act(() => socket.close());
	act(() => result.current.sendCommand("skip"));
	expect(socket.send).toHaveBeenCalledOnce();
	expect(trackEvent).not.toHaveBeenCalled();
	unmount();
});
