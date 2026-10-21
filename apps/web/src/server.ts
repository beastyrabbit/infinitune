import "./lib/telemetry/instrument.server";
import {
	captureError,
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

const fetch = createStartHandler(defaultStreamHandler);

export type ServerEntry = { fetch: RequestHandler<Register> };

export function createServerEntry(entry: ServerEntry): ServerEntry {
	return {
		async fetch(...args) {
			try {
				const response = await withTelemetrySpan(
					"Frontend request",
					"http.server",
					() => entry.fetch(...args),
				);
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
