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
		dataCollection: {
			userInfo: false,
			cookies: false,
			httpHeaders: false,
			httpBodies: [],
			urlQueryParams: false,
			graphQL: { document: false, variables: false },
			genAI: { inputs: false, outputs: false },
			databaseQueryData: false,
			queues: false,
			stackFrameVariables: false,
			frameContextLines: 0,
		},
		tracesSampleRate: config.tracesSampleRate,
		integrations: (defaults) => [
			...defaults.filter(
				(integration) => integration.name !== "BrowserSession",
			),
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
