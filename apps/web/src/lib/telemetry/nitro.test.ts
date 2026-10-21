import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	flush: vi.fn(),
	capture: vi.fn(),
	init: vi.fn(),
}));
vi.mock("@infinitune/shared/telemetry-node", () => ({
	flushTelemetry: mocks.flush,
	captureError: mocks.capture,
	initNodeTelemetry: mocks.init,
}));
vi.mock("nitro", () => ({ definePlugin: (plugin: unknown) => plugin }));

import plugin from "./nitro";

let signals: EventEmitter;
const hooks = new Map<string, (...args: unknown[]) => unknown>();

beforeEach(() => {
	vi.clearAllMocks();
	hooks.clear();
	signals = new EventEmitter();
	vi.spyOn(process, "once").mockImplementation((event, listener) => {
		signals.once(event, listener);
		return process;
	});
	vi.spyOn(process, "off").mockImplementation((event, listener) => {
		signals.off(event, listener);
		return process;
	});
	vi.spyOn(process, "listenerCount").mockImplementation(
		signals.listenerCount.bind(signals),
	);
	vi.spyOn(process, "kill").mockReturnValue(true);
	plugin({
		hooks: {
			hook: (name: string, handler: (...args: unknown[]) => unknown) =>
				hooks.set(name, handler),
		},
	} as never);
});
afterEach(() => vi.restoreAllMocks());

it("captures Nitro exceptions and awaits pending telemetry on close", async () => {
	expect(mocks.init).toHaveBeenCalledExactlyOnceWith("frontend");
	let finish!: () => void;
	mocks.flush.mockReturnValue(
		new Promise<void>((resolve) => {
			finish = resolve;
		}),
	);
	const error = new Error("SSR failed");
	hooks.get("error")?.(error);
	expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, {
		runtime: "nitro",
	});
	let closed = false;
	const close = async () => {
		await hooks.get("close")?.();
		closed = true;
	};
	const pending = close();
	expect(mocks.flush).toHaveBeenCalledOnce();
	expect(closed).toBe(false);
	finish();
	await pending;
	expect(closed).toBe(true);
	expect(signals.listenerCount("SIGTERM")).toBe(0);
	expect(signals.listenerCount("SIGINT")).toBe(0);
});

it.each(["SIGTERM", "SIGINT"] as const)(
	"flushes once on %s alongside existing server shutdown without forcing exit",
	async (signal) => {
		mocks.flush.mockResolvedValue(undefined);
		const serverShutdown = vi.fn();
		signals.on(signal, serverShutdown);
		const [listener] = signals.rawListeners(signal);
		await listener();
		signals.emit(signal);
		await hooks.get("close")?.();
		expect(mocks.flush).toHaveBeenCalledOnce();
		expect(serverShutdown).toHaveBeenCalledOnce();
		expect(process.kill).not.toHaveBeenCalled();
	},
);

it.each(["SIGTERM", "SIGINT"] as const)(
	"restores default %s termination only after flushing when the server has no signal handler",
	async (signal) => {
		let finish!: () => void;
		mocks.flush.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		const [listener] = signals.rawListeners(signal);
		const pending = listener();
		expect(process.kill).not.toHaveBeenCalled();
		finish();
		await pending;
		expect(process.kill).toHaveBeenCalledExactlyOnceWith(process.pid, signal);
	},
);
