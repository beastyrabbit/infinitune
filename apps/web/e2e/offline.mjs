// Fail closed for SSR SDK transports too; route mocks cover only the browser.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

const local = (hostname) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
for (const module of [http, https]) {
	const request = module.request;
	module.request = function (input, ...args) {
		const hostname = typeof input === "string" || input instanceof URL ? new URL(input).hostname : input.hostname || input.host;
		if (!local(hostname)) throw new Error("E2E blocked external Node request");
		return request.call(this, input, ...args);
	};
}
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
	if (!local(url.hostname)) return Promise.reject(new Error("E2E blocked external Node fetch"));
	return originalFetch(input, init);
};
