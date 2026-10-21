import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { error?: unknown; result?: unknown };
const fixture = vi.hoisted(() => ({
	handler: undefined as
		| undefined
		| ((options: { next: () => Promise<Result> }) => Promise<Result>),
	capture: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
	createMiddleware: () => ({
		server: (handler: typeof fixture.handler) => {
			fixture.handler = handler;
			return handler;
		},
	}),
	createStart: (options: () => unknown) => options(),
}));
vi.mock("@infinitune/shared/telemetry-node", () => ({
	captureError: fixture.capture,
}));

describe("server function error reporting", () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		await import("./start");
	});
	it("reports serialized errors and preserves the function result", async () => {
		const error = new Error("server function failed");
		const result = { error };
		expect(await fixture.handler?.({ next: async () => result })).toBe(result);
		expect(fixture.capture).toHaveBeenCalledWith(error, {
			runtime: "server-function",
		});
	});
	it("reports thrown errors and rethrows the original", async () => {
		const error = new Error("server function failed");
		await expect(
			fixture.handler?.({
				next: async () => {
					throw error;
				},
			}),
		).rejects.toBe(error);
		expect(fixture.capture).toHaveBeenCalledWith(error, {
			runtime: "server-function",
		});
	});
});
