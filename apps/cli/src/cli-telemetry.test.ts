import { afterEach, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
	captureError: vi.fn(),
	flushTelemetry: vi.fn(),
	initNodeTelemetry: vi.fn(),
}));
vi.mock("@infinitune/shared/telemetry-node", () => telemetry);

const originalArgv = process.argv;
afterEach(() => {
	process.argv = originalArgv;
	vi.restoreAllMocks();
});

it("captures and finishes flushing before printing the CLI error and exiting 1", async () => {
	const order: string[] = [];
	telemetry.captureError.mockImplementation(() => order.push("capture"));
	telemetry.flushTelemetry.mockImplementation(async () => {
		order.push("flush");
		await Promise.resolve();
		order.push("flushed");
	});
	const print = vi.spyOn(console, "error").mockImplementation(() => {
		order.push("print");
	});
	const exit = vi.spyOn(process, "exit").mockImplementation(() => {
		order.push("exit");
		throw new Error("test process exit");
	});
	process.argv = [process.execPath, "cli.ts", "unknown-test-command"];

	await expect(import("./cli")).rejects.toThrow("test process exit");

	expect(order).toEqual(["capture", "flush", "flushed", "print", "exit"]);
	expect(telemetry.captureError).toHaveBeenCalledWith(
		expect.objectContaining({
			message: "Unknown command: unknown-test-command",
		}),
		{ runtime: "cli" },
	);
	expect(print).toHaveBeenCalledWith(
		"Error: Unknown command: unknown-test-command",
	);
	expect(exit).toHaveBeenCalledWith(1);
});
