import * as Sentry from "@sentry/node";
import {
	scrubTelemetry,
	type TelemetryConfig,
	telemetryConfig,
} from "./telemetry";

let initialized = false;
const captured = new WeakSet<object>();
// Node prints process warnings through console.error, e.g.
// "(node:42) [DEP0205] DeprecationWarning: ...".
const NODE_PROCESS_WARNING = /^\(node:\d+\) (\[\w+\] )?\w*Warning: /;

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
		// No auto-instrumentation is used, and Node 26 deprecates module.register().
		registerEsmLoaderHooks: false,
		integrations: [
			Sentry.onUncaughtExceptionIntegration(),
			Sentry.onUnhandledRejectionIntegration(),
			Sentry.linkedErrorsIntegration(),
			...(runtime === "frontend"
				? [Sentry.captureConsoleIntegration({ levels: ["error"] })]
				: []),
		],
		beforeSend: (event) => {
			if (
				event.logger === "console" &&
				NODE_PROCESS_WARNING.test(event.message ?? "")
			)
				return null;
			const scrubbed = scrubTelemetry({ ...event, user: undefined });
			if (scrubbed.fingerprint?.[0] === "song-pipeline") {
				for (const exception of scrubbed.exception?.values || []) {
					if (exception.value) exception.value = exception.value.slice(0, 500);
				}
			}
			return scrubbed;
		},
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
	fingerprint?: string[],
): void {
	if (!initialized) return;
	if (error && typeof error === "object") {
		if (captured.has(error)) return;
		captured.add(error);
	}
	Sentry.captureException(error, {
		tags: scrubTelemetry(tags),
		...(fingerprint ? { fingerprint: scrubTelemetry(fingerprint) } : {}),
	});
}

export function captureLog(
	args: unknown[],
	message?: string,
	bindings: Record<string, unknown> = {},
): void {
	if (!initialized) return;
	const fields = args[0];
	const context: Record<string, unknown> = { ...bindings };
	if (fields && typeof fields === "object") Object.assign(context, fields);
	// Sentry's global integrations capture these with the original error/stack.
	if ("globalErrorHandler" in context) return;
	// Only defer failures that will be reported by song.status_changed. Capturing
	// their Error here would consume the identity dedupe before the tagged report.
	if (context.pipelineFailure === true) return;
	const tags: Record<string, string> = {};
	for (const key of ["songId", "playlistId", "stage"]) {
		if (typeof context[key] === "string") tags[key] = context[key];
	}
	const err = context.err;
	if (err instanceof Error) captureError(err, tags);
	// String log messages and arbitrary fields may contain provider/user content.
	else if (!("status" in context))
		Sentry.captureMessage(message || "Server error log", {
			level: "error",
			tags: scrubTelemetry(tags),
		});
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

export function updateTelemetrySpanName(name: string): void {
	if (initialized) Sentry.getActiveSpan()?.updateName(name);
}
