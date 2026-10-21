import * as Sentry from "@sentry/node";
import {
	scrubTelemetry,
	type TelemetryConfig,
	telemetryConfig,
} from "./telemetry";

let initialized = false;
const captured = new WeakSet<object>();

export function initNodeTelemetry(
	runtime: string,
	config: TelemetryConfig = telemetryConfig(process.env),
): boolean {
	if (initialized || !config.enabled || !config.dsn) return false;
	Sentry.init({
		dsn: config.dsn,
		environment: config.environment,
		release: config.release,
		sendDefaultPii: false,
		tracesSampleRate: config.tracesSampleRate,
		// Avoid implicit request/body/console collection and duplicate Hono captures.
		defaultIntegrations: false,
		integrations: [
			Sentry.onUncaughtExceptionIntegration(),
			Sentry.onUnhandledRejectionIntegration(),
			Sentry.linkedErrorsIntegration(),
			...(runtime === "frontend"
				? [Sentry.captureConsoleIntegration({ levels: ["error"] })]
				: []),
		],
		beforeSend: (event) => scrubTelemetry({ ...event, user: undefined }),
		beforeSendTransaction: (event) =>
			scrubTelemetry({ ...event, user: undefined }),
		beforeBreadcrumb: (breadcrumb) => scrubTelemetry(breadcrumb),
		initialScope: { tags: { runtime } },
	});
	initialized = true;
	return true;
}

export function captureError(
	error: unknown,
	tags: Record<string, string> = {},
): void {
	if (!initialized) return;
	if (error && typeof error === "object") {
		if (captured.has(error)) return;
		captured.add(error);
	}
	Sentry.captureException(error, { tags: scrubTelemetry(tags) });
}

export function captureLog(args: unknown[], message?: string): void {
	if (!initialized) return;
	const fields = args[0];
	const err =
		fields && typeof fields === "object"
			? (fields as { err?: unknown }).err
			: undefined;
	if (err instanceof Error) captureError(err);
	// String log messages and arbitrary fields may contain provider/user content.
	else if (!(fields && typeof fields === "object" && "status" in fields))
		Sentry.captureMessage(message || "Server error log", "error");
}

export function withTelemetrySpan<T>(
	name: string,
	operation: string,
	callback: () => T,
): T {
	return initialized
		? Sentry.startSpan({ name, op: operation }, callback)
		: callback();
}

export async function flushTelemetry(): Promise<void> {
	if (initialized) await Sentry.flush(1500);
}
