import type { TelemetryConfig } from "@infinitune/shared/telemetry";
import { browserAllowed } from "./browser";

let sdk: Pick<typeof import("@sentry/react"), "captureException"> | undefined;
let loading: Promise<void> | undefined;
const pending: unknown[] = [];

export function captureBrowserError(error: unknown): void {
	if (sdk) sdk.captureException(error);
	else if (pending.length < 10) pending.push(error);
}

export function startBrowserSentry(config: TelemetryConfig): Promise<void> {
	if (
		!config.dsn ||
		typeof window === "undefined" ||
		!browserAllowed(config, {
			dev: import.meta.env.DEV,
			webdriver: navigator.webdriver,
			hostname: location.hostname,
		})
	)
		return Promise.resolve();
	loading ??= import("./sentry-sdk")
		.then(({ initialize }) => {
			sdk = initialize(config);
			for (const error of pending.splice(0)) sdk.captureException(error);
		})
		.catch(() => {
			pending.length = 0;
		});
	return loading;
}
