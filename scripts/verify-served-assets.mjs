import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Optional output directory and origin also allow checking an actual container
// against its extracted public files. By default, start the built Nitro server.
const output = resolve(process.argv[2] || "apps/web/.output");
const externalOrigin = process.argv[3];

function startServer() {
	const server = spawn(process.execPath, [resolve(output, "server/index.mjs")], {
		env: {
			PATH: process.env.PATH,
			NODE_ENV: "production",
			HOST: "127.0.0.1",
			PORT: "0",
			APP_ORIGIN: "http://127.0.0.1",
			INTERNAL_API_URL: "http://127.0.0.1:5175",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const exited = once(server, "exit");
	const ready = new Promise((resolveReady, reject) => {
		let logs = "";
		const timeout = setTimeout(() => reject(new Error(`Nitro startup timed out: ${logs}`)), 30_000);
		const inspect = (data) => {
			logs += data.toString();
			const address = logs.match(/http:\/\/127\.0\.0\.1:\d+/);
			if (address) {
				clearTimeout(timeout);
				resolveReady(address[0]);
			}
		};
		server.stdout.on("data", inspect);
		server.stderr.on("data", inspect);
		server.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		server.once("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`Nitro exited with ${code}: ${logs}`));
		});
	});
	return { server, exited, ready };
}

async function verifyAssets(origin) {
	const publicDir = resolve(output, "public");
	const files = await readdir(resolve(publicDir, "assets"), { recursive: true });
	const scripts = files.filter((file) => file.endsWith(".js"));
	assert.ok(scripts.length > 0, "No built JavaScript assets found");
	let totalBytes = 0;
	for (const file of scripts) {
		const path = `/assets/${file}`;
		const disk = await readFile(resolve(publicDir, "assets", file));
		const response = await fetch(new URL(path, origin), {
			headers: { "Accept-Encoding": "identity" },
			signal: AbortSignal.timeout(10_000),
		});
		assert.equal(response.status, 200, `${path}: HTTP status`);
		assert.equal(response.headers.get("content-length"), String(disk.length), `${path}: Content-Length differs from disk`);
		const served = Buffer.from(await response.arrayBuffer());
		assert.equal(served.length, disk.length, `${path}: response byte length differs from disk`);
		assert.ok(served.equals(disk), `${path}: response bytes differ from disk`);
		const parsed = spawnSync(process.execPath, ["--input-type=module", "--check"], {
			input: served,
			encoding: "utf8",
			timeout: 10_000,
		});
		assert.equal(parsed.status, 0, `${path}: module parse failed: ${parsed.stderr || parsed.error}`);
		totalBytes += disk.length;
	}
	console.log(`Verified ${scripts.length} served JavaScript assets (${totalBytes} bytes): Content-Length, response bytes, disk bytes and module parsing all match.`);
}

const running = externalOrigin ? undefined : startServer();
try {
	await verifyAssets(externalOrigin || await running.ready);
} finally {
	if (running && running.server.exitCode === null) {
		running.server.kill("SIGTERM");
		const timeout = setTimeout(() => running.server.kill("SIGKILL"), 5_000);
		await running.exited;
		clearTimeout(timeout);
	}
}
