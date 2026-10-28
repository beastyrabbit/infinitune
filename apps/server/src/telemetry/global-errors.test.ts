import type { Event } from "@sentry/node";
import { afterEach, expect, it, vi } from "vitest";

const { events } = vi.hoisted(() => ({ events: [] as Event[] }));

// Exercise the real SDK integrations with an in-memory transport only.
vi.mock("@sentry/node", async (importOriginal) => {
	const sdk = await importOriginal<typeof import("@sentry/node")>();
	return {
		...sdk,
		init: (options: Parameters<typeof sdk.init>[0]) =>
			sdk.init({
				...options,
				transport: () => ({
					send: async (envelope) => {
						for (const [header, payload] of envelope[1]) {
							if (header.type === "event") events.push(payload as Event);
						}
						return { statusCode: 200 };
					},
					flush: async () => true,
				}),
			}),
	};
});

afterEach(() => vi.restoreAllMocks());

it.each(["server", "frontend", "cli"])(
	"captures each global incident once with its stack in %s",
	async (runtime) => {
		vi.resetModules();
		events.length = 0;
		const beforeException = process.listeners("uncaughtException");
		const beforeRejection = process.listeners("unhandledRejection");
		const sdk = await import("@sentry/node");
		const { telemetryConfig } = await import("@infinitune/shared/telemetry");
		const { initNodeTelemetry } = await import(
			"@infinitune/shared/telemetry-node"
		);
		const { logger } = await import("../logger");
		// Keep simulated uncaught errors from terminating the Vitest worker.
		const keepAlive = () => {};
		process.on("uncaughtException", keepAlive);
		try {
			initNodeTelemetry(
				runtime,
				telemetryConfig({
					NODE_ENV: "production",
					GLITCHTIP_DSN: "https://public@example.invalid/1",
					GLITCHTIP_TRACES_SAMPLE_RATE: "0",
				}),
			);
			const uncaught = process
				.listeners("uncaughtException")
				.find(
					(listener) =>
						listener !== keepAlive && !beforeException.includes(listener),
				);
			const rejection = process
				.listeners("unhandledRejection")
				.find((listener) => !beforeRejection.includes(listener));
			expect(uncaught).toBeDefined();
			expect(rejection).toBeDefined();
			const error = new Error(`Uncaught ${runtime}`);
			const reason = new TypeError(`Rejected ${runtime}`);
			uncaught?.(error, "uncaughtException");
			if (runtime === "server")
				logger.fatal(
					{ err: error, globalErrorHandler: true },
					"Uncaught exception",
				);
			rejection?.(reason, Promise.resolve());
			if (runtime === "server")
				logger.error(
					{ reason, globalErrorHandler: true },
					"Unhandled promise rejection",
				);
			await sdk.flush(1500);
			expect(events).toHaveLength(2);
			for (const incident of [error, reason]) {
				const matches = events.filter(
					(event) => event.exception?.values?.[0]?.value === incident.message,
				);
				expect(matches).toHaveLength(1);
				expect(
					matches[0].exception?.values?.[0]?.stacktrace?.frames?.length,
				).toBeGreaterThan(0);
			}
		} finally {
			await sdk.close(1500);
			for (const listener of process.listeners("uncaughtException")) {
				if (!beforeException.includes(listener))
					process.removeListener("uncaughtException", listener);
			}
			for (const listener of process.listeners("unhandledRejection")) {
				if (!beforeRejection.includes(listener))
					process.removeListener("unhandledRejection", listener);
			}
		}
	},
);
