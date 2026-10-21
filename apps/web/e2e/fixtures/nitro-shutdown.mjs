import "../offline.mjs";
import http from "node:http";
import * as Sentry from "@sentry/node";

// Wait for the actual server lifecycle rather than a fixed startup delay.
const listen = http.Server.prototype.listen;
const listening = new Promise((resolve) => {
	http.Server.prototype.listen = function (...args) {
		this.once("listening", resolve);
		return listen.apply(this, args);
	};
});
await import("../../.output/server/index.mjs");
await listening;
const client = Sentry.getClient();
if (!client) throw new Error("Built Nitro server did not initialize telemetry");
const flush = client.flush.bind(client);
client.flush = async (timeout) => {
	process.send({ type: "flushing", timeout });
	const result = await flush(timeout);
	process.send({ type: "flushed", result });
	return result;
};
process.once("message", () => {
	globalThis.__nitro__.default.captureError(new TypeError("Nitro shutdown fixture"));
	process.send({ type: "captured" });
});
process.send({ type: "ready" });
