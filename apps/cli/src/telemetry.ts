import { initNodeTelemetry } from "@infinitune/shared/telemetry-node";

// CLI and daemon use explicit environment configuration, including opt-in
// TELEMETRY_ENABLED=true outside a production NODE_ENV.
initNodeTelemetry("cli");
