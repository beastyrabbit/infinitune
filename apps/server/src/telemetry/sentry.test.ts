import { telemetryConfig } from "@infinitune/shared/telemetry";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
	init: vi.fn(),
	onUncaughtExceptionIntegration: vi.fn(),
	onUnhandledRejectionIntegration: vi.fn(),
	dedupeIntegration: vi.fn(),
	linkedErrorsIntegration: vi.fn(),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	flush: vi.fn(),
}));

describe("Node Sentry initialization", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});
	it("does not initialize without a DSN or in tests/local development", async () => {
		const { initNodeTelemetry } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { init } = await import("@sentry/node");
		for (const env of [
			{ NODE_ENV: "production" },
			{ NODE_ENV: "test", GLITCHTIP_DSN: "dsn" },
			{ GLITCHTIP_DSN: "dsn" },
		])
			expect(initNodeTelemetry("test", telemetryConfig(env))).toBe(false);
		expect(init).not.toHaveBeenCalled();
	});
	it("initializes once with matching release/environment and no default PII", async () => {
		const { initNodeTelemetry, captureError } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { init, captureException } = await import("@sentry/node");
		const config = telemetryConfig({
			NODE_ENV: "production",
			GLITCHTIP_DSN: "https://public@example.com/1",
			INFINITUNE_RELEASE: "1.3.0",
		});
		expect(initNodeTelemetry("server", config)).toBe(true);
		expect(initNodeTelemetry("server", config)).toBe(false);
		expect(init).toHaveBeenCalledWith(
			expect.objectContaining({
				release: "1.3.0",
				environment: "production",
				sendDefaultPii: false,
			}),
		);
		const error = new Error("failure");
		captureError(error);
		captureError(error);
		expect(captureException).toHaveBeenCalledOnce();
	});
});
