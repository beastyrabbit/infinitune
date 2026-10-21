import {
	scrubTelemetry,
	type TelemetryConfig,
} from "@infinitune/shared/telemetry";
import {
	browserTracingIntegration,
	captureConsoleIntegration,
	captureException,
	init,
} from "@sentry/react";

export function initialize(config: TelemetryConfig) {
	init({
		dsn: config.dsn,
		environment: config.environment,
		release: config.release,
		sendDefaultPii: false,
		tracesSampleRate: config.tracesSampleRate,
		integrations: [
			captureConsoleIntegration({ levels: ["error"] }),
			browserTracingIntegration(),
		],
		tracePropagationTargets: [],
		beforeSend: (event) => scrubTelemetry({ ...event, user: undefined }),
		beforeSendTransaction: (event) =>
			scrubTelemetry({ ...event, user: undefined }),
		beforeBreadcrumb: (breadcrumb) =>
			breadcrumb.category === "ui.click" || breadcrumb.category === "ui.input"
				? null
				: scrubTelemetry(breadcrumb),
	});
	return { captureException };
}
