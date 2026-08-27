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
			return await entry.fetch(...args);
		},
	};
}

export default createServerEntry({ fetch });
