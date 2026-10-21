import {
	captureError,
	flushTelemetry,
	initNodeTelemetry,
} from "@infinitune/shared/telemetry-node";
import { definePlugin } from "nitro";

export default definePlugin((app) => {
	// Nitro tree-shakes side-effect-only imports, so initialize in the plugin.
	initNodeTelemetry("frontend");
	let flushing: Promise<void> | undefined;
	const flush = () => {
		flushing ??= flushTelemetry();
		return flushing;
	};
	const onSignal = async (signal: NodeJS.Signals) => {
		try {
			await flush();
		} finally {
			// srvx normally closes the HTTP server alongside this listener. When
			// its signal handlers are disabled (CI/TEST), restore the default exit.
			if (process.listenerCount(signal) === 0)
				process.kill(process.pid, signal);
		}
	};
	const onSigterm = () => onSignal("SIGTERM");
	const onSigint = () => onSignal("SIGINT");
	// This pinned node-server preset does not invoke Nitro's close hook on signals.
	process.once("SIGTERM", onSigterm);
	process.once("SIGINT", onSigint);
	app.hooks.hook("close", async () => {
		process.off("SIGTERM", onSigterm);
		process.off("SIGINT", onSigint);
		await flush();
	});
	app.hooks.hook("error", (error) => {
		captureError(error, { runtime: "nitro" });
	});
});
