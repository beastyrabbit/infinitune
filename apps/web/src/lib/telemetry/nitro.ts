import "./instrument.server";
import { captureError } from "@infinitune/shared/telemetry-node";
import { definePlugin } from "nitro";

export default definePlugin((app) => {
	app.hooks.hook("error", (error) => {
		captureError(error, { runtime: "nitro" });
	});
});
