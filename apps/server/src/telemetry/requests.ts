import { shouldTraceRequest } from "@infinitune/shared/telemetry";
import {
	updateTelemetrySpanName,
	withTelemetrySpan,
} from "@infinitune/shared/telemetry-node";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

const websocketPaths = new Set(["/ws", "/ws/playlist", "/ws/radio"]);

export const telemetryRequests: MiddlewareHandler = (c, next) => {
	if (
		!shouldTraceRequest(c.req.path, c.req.header("user-agent")) ||
		websocketPaths.has(c.req.path)
	)
		return next();
	return withTelemetrySpan(
		`${c.req.method} unmatched`,
		"http.server",
		async () => {
			try {
				await next();
			} finally {
				// The matched handler is only known after Hono dispatches the request.
				const pattern = routePath(c);
				updateTelemetrySpanName(
					`${c.req.method} ${pattern && pattern !== "*" && pattern !== "/*" ? pattern : "unmatched"}`,
				);
			}
		},
	);
};
