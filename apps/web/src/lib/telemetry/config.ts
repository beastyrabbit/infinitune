import { telemetryConfig } from "@infinitune/shared/telemetry";
import { createServerFn } from "@tanstack/react-start";

// Executed only on the SSR server; Start serializes this allowlisted result.
export const getTelemetryConfig = createServerFn({ method: "GET" }).handler(
	() => telemetryConfig(process.env),
);
