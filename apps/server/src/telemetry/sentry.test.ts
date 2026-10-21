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

	it("defers song-scoped pino failures and reports the original exception once with scrubbed bounded messages", async () => {
		const { initNodeTelemetry, captureError, captureLog } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { init, captureException } = await import("@sentry/node");
		initNodeTelemetry(
			"server",
			telemetryConfig({
				NODE_ENV: "production",
				GLITCHTIP_DSN: "https://public@example.com/1",
			}),
		);
		const error = new TypeError(
			`Provider private@example.com token=private-token ${"x".repeat(600)}`,
		);
		const originalStack = error.stack;
		captureLog([{ songId: "song", err: error }]);
		const fingerprint = ["song-pipeline", "generating_metadata", "TypeError"];
		captureError(error, { songId: "song" }, fingerprint);
		captureError(error, { songId: "song" }, fingerprint);
		expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
			tags: { songId: "song" },
			fingerprint,
		});
		const options = vi.mocked(init).mock.calls[0][0];
		const processed = await options?.beforeSend?.(
			{
				type: undefined,
				fingerprint,
				exception: {
					values: [
						{
							type: error.name,
							value: error.message,
							stacktrace: { frames: [{ filename: "worker.ts", lineno: 42 }] },
						},
					],
				},
			},
			{},
		);
		expect(processed?.exception?.values?.[0]?.value).toHaveLength(500);
		expect(JSON.stringify(processed)).not.toMatch(
			/private@example|private-token/,
		);
		expect(processed?.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
			filename: "worker.ts",
			lineno: 42,
		});
		expect(error.stack).toBe(originalStack);
		expect(error.message).toContain("private-token");
	});
});
