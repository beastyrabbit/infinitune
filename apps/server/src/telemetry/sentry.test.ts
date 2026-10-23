import { telemetryConfig } from "@infinitune/shared/telemetry";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
	init: vi.fn(),
	onUncaughtExceptionIntegration: vi.fn(),
	onUnhandledRejectionIntegration: vi.fn(),
	dedupeIntegration: vi.fn(),
	linkedErrorsIntegration: vi.fn(),
	captureConsoleIntegration: vi.fn(),
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
				registerEsmLoaderHooks: false,
			}),
		);
		const error = new Error("failure");
		captureError(error);
		captureError(error);
		expect(captureException).toHaveBeenCalledOnce();
	});
	it("bounds the shutdown flush to 1.5 seconds and tolerates a timeout", async () => {
		const { initNodeTelemetry, flushTelemetry } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { flush } = await import("@sentry/node");
		initNodeTelemetry(
			"server",
			telemetryConfig({
				NODE_ENV: "production",
				GLITCHTIP_DSN: "https://public@example.com/1",
			}),
		);
		vi.mocked(flush).mockResolvedValueOnce(false);
		await expect(flushTelemetry()).resolves.toBeUndefined();
		expect(flush).toHaveBeenCalledExactlyOnceWith(1500);
	});

	it.each(["cover", "persona", "mark_error", "retry"])(
		"captures independent %s failures once with song context from pino bindings",
		async (stage) => {
			const { initNodeTelemetry } = await import(
				"@infinitune/shared/telemetry-node"
			);
			const { captureException, captureMessage } = await import("@sentry/node");
			const { songLogger } = await import("../logger");
			initNodeTelemetry(
				"server",
				telemetryConfig({
					NODE_ENV: "production",
					GLITCHTIP_DSN: "https://public@example.com/1",
				}),
			);
			const error = new TypeError("Independent failure");
			const log = songLogger("song", "playlist");
			log.error({ err: error, stage }, "Independent failure");
			log.error({ err: error, stage }, "Repeated log of the same error");
			expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
				tags: { songId: "song", playlistId: "playlist", stage },
			});
			expect(captureMessage).not.toHaveBeenCalled();
		},
	);

	it("captures independent song errors from root log fields without stringifying arbitrary tags", async () => {
		const { initNodeTelemetry } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { captureException } = await import("@sentry/node");
		const { logger } = await import("../logger");
		initNodeTelemetry(
			"server",
			telemetryConfig({
				NODE_ENV: "production",
				GLITCHTIP_DSN: "https://public@example.com/1",
			}),
		);
		const error = new Error("Playback update failed");
		logger.error({ err: error, songId: "song", playlistId: {}, stage: [] });
		expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
			tags: { songId: "song" },
		});
	});

	it("defers explicitly marked pino pipeline failures and reports the original exception once with scrubbed bounded messages", async () => {
		const { initNodeTelemetry, captureError } = await import(
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
		const { logger, songLogger } = await import("../logger");
		songLogger("song").error({ err: error, pipelineFailure: true });
		logger.error({ songId: "song", err: error, pipelineFailure: true });
		songLogger("song").error({
			error: "Pipeline failed",
			pipelineFailure: true,
		});
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

	it("drops Node process warnings captured from console.error", async () => {
		const { initNodeTelemetry } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { init } = await import("@sentry/node");
		initNodeTelemetry(
			"frontend",
			telemetryConfig({
				NODE_ENV: "production",
				GLITCHTIP_DSN: "https://public@example.com/1",
			}),
		);
		const beforeSend = vi.mocked(init).mock.calls[0][0]?.beforeSend;
		const send = (event: { logger?: string; message: string }) =>
			beforeSend?.({ type: undefined, ...event }, {});
		for (const message of [
			"(node:7) [DEP0205] DeprecationWarning: `module.register()` is deprecated.",
			"(node:7) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.",
		])
			expect(await send({ logger: "console", message })).toBeNull();
		expect(
			await send({ logger: "console", message: "SSR render failed" }),
		).toMatchObject({ message: "SSR render failed" });
		expect(
			await send({ message: "(node:7) DeprecationWarning: not from console" }),
		).not.toBeNull();
	});
});
