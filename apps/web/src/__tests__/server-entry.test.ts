import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const serverEntry = new URL("../server.ts", import.meta.url).pathname;
const tsx = new URL("../../../../node_modules/.bin/tsx", import.meta.url)
	.pathname;

function runProductionServerEntry(appOrigin?: string) {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: "production",
	};
	delete env.APP_ORIGIN;
	if (appOrigin !== undefined) env.APP_ORIGIN = appOrigin;
	return spawnSync(tsx, [serverEntry], {
		env,
		encoding: "utf8",
		timeout: 10_000,
	});
}

describe("production web server entry", () => {
	it("refuses to start without APP_ORIGIN", () => {
		const result = runProductionServerEntry();
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			"APP_ORIGIN must be an absolute HTTP(S) origin in production",
		);
	});

	it("accepts an origin-only APP_ORIGIN", () => {
		const result = runProductionServerEntry("https://music.example.com");
		expect(result.status).toBe(0);
	});
});
