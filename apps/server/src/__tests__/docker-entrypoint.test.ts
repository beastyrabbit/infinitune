import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const entrypoint = new URL("../../../../docker-entrypoint.sh", import.meta.url)
	.pathname;
const workspacePackageJson = new URL(
	"../../../../package.json",
	import.meta.url,
).pathname;
const temporaryDirectories: string[] = [];

function runEntrypoint(
	appOrigin: string,
	options: {
		processType?: "frontend" | "server";
		trustedProxyIps?: string;
	} = {},
): number {
	const directory = mkdtempSync(join(tmpdir(), "infinitune-entrypoint-"));
	temporaryDirectories.push(directory);
	const nodeShim = join(directory, "node");
	writeFileSync(
		nodeShim,
		`#!/bin/sh\nif [ "$1" = "-e" ]; then\n  exec ${JSON.stringify(process.execPath)} "$@"\nfi\nexit 0\n`,
	);
	chmodSync(nodeShim, 0o755);
	const binaryDirectory = join(directory, "node_modules", ".bin");
	mkdirSync(binaryDirectory, { recursive: true });
	const tsxShim = join(binaryDirectory, "tsx");
	writeFileSync(tsxShim, "#!/bin/sh\nexit 0\n");
	chmodSync(tsxShim, 0o755);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		APP_ORIGIN: appOrigin,
		PATH: `${directory}:${process.env.PATH ?? ""}`,
		PROCESS_TYPE: options.processType ?? "frontend",
	};
	delete env.RATE_LIMIT_TRUSTED_PROXY_IPS;
	if (options.trustedProxyIps !== undefined) {
		env.RATE_LIMIT_TRUSTED_PROXY_IPS = options.trustedProxyIps;
	}

	try {
		execFileSync(entrypoint, {
			cwd: directory,
			env,
			stdio: "ignore",
		});
		return 0;
	} catch (error) {
		return typeof error === "object" && error && "status" in error
			? Number(error.status)
			: -1;
	}
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("production APP_ORIGIN validation", () => {
	it.each([
		"https://music.example.com",
		"https://music.example.com/",
		"http://localhost:5173",
	])("accepts an origin-only HTTP(S) URL: %s", (origin) => {
		expect(runEntrypoint(origin)).toBe(0);
	});

	it.each([
		"https://music.example.com?",
		"https://music.example.com#",
		"https://@music.example.com",
		"https://music.example.com/a/..",
		"https://music.example.com/path",
	])("rejects a raw value that is not only an origin: %s", (origin) => {
		expect(runEntrypoint(origin)).toBe(1);
	});
});

describe("development proxy trust", () => {
	it("trusts loopback hops used by the SSR share loader", () => {
		const packageJson = JSON.parse(
			readFileSync(workspacePackageJson, "utf8"),
		) as { scripts: Record<string, string> };

		for (const scriptName of ["dev:server", "dev:server:fallback"]) {
			expect(packageJson.scripts[scriptName]).toContain(
				"RATE_LIMIT_TRUSTED_PROXY_IPS=127.0.0.1,::1",
			);
		}
	});
});

describe("production proxy trust", () => {
	it.each([
		undefined,
		"   ",
		"garbage",
		"10.0.0.999/8",
		"127.0.0.1,",
		"127.0.0.1/",
		"127.0.0.1/33",
		"fd00::/129",
	])("rejects an invalid server trust list: %s", (trustedProxyIps) => {
		expect(
			runEntrypoint("https://music.example.com", {
				processType: "server",
				trustedProxyIps,
			}),
		).toBe(1);
	});

	it.each(["127.0.0.1", "127.0.0.1,10.42.0.0/16", "::1,fd00::/8"])(
		"accepts a valid server trust list: %s",
		(trustedProxyIps) => {
			expect(
				runEntrypoint("https://music.example.com", {
					processType: "server",
					trustedProxyIps,
				}),
			).toBe(0);
		},
	);
});
