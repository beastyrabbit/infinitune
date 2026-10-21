import "./lib/telemetry/instrument.server";
import { shouldTraceRequest } from "@infinitune/shared/telemetry";
import {
	captureError,
	updateTelemetrySpanName,
	withTelemetrySpan,
} from "@infinitune/shared/telemetry-node";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";
import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import { assertProductionAppOrigin } from "@/lib/endpoints";

assertProductionAppOrigin({
	nodeEnv: process.env.NODE_ENV,
	appOrigin: process.env.APP_ORIGIN,
});

const fetch = createStartHandler((context) => {
	const match = context.router.state.matches.at(-1);
	const pattern =
		match && match.status !== "notFound"
			? context.router.routesById[match.routeId]?.fullPath
			: undefined;
	updateTelemetrySpanName(
		`${context.request.method} ${pattern || "unmatched"}`,
	);
	return defaultStreamHandler(context);
});

export type ServerEntry = { fetch: RequestHandler<Register> };

export function createServerEntry(entry: ServerEntry): ServerEntry {
	return {
		async fetch(...args) {
			try {
				const request = args[0];
				const pathname = new URL(request.url).pathname;
				const response = shouldTraceRequest(
					pathname,
					request.headers.get("user-agent") || "",
				)
					? await withTelemetrySpan(
							`${request.method} ${pathname.startsWith("/_serverFn/") ? "server-function" : "unmatched"}`,
							"http.server",
							() => entry.fetch(...args),
						)
					: await entry.fetch(...args);
				if (response.status >= 500)
					captureError(new Error("Frontend request failed"), {
						runtime: "start",
						status: String(response.status),
					});
				return response;
			} catch (error) {
				captureError(error, { runtime: "start" });
				throw error;
			}
		},
	};
}

export default createServerEntry({ fetch });
