import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

const script = new URL(
	"../../../../scripts/verify-telemetry-sourcemaps.sh",
	import.meta.url,
).pathname;
let directory: string;
let exported: string;
let runtime: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "infinitune-sourcemaps-"));
	exported = join(directory, "export");
	runtime = join(directory, "runtime");
	mkdirSync(exported);
	mkdirSync(runtime);
	writeFileSync(join(exported, "entry.js"), "injected JavaScript");
	writeFileSync(join(runtime, "entry.js"), "injected JavaScript");
	writeFileSync(join(exported, "entry.js.map"), "map");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

const verify = () =>
	spawnSync("bash", [script, exported, runtime], { encoding: "utf8" });

it("accepts identical JavaScript with maps only in the export", () => {
	const result = verify();
	expect(result.status).toBe(0);
	expect(result.stdout).toContain("Verified 1 JavaScript files");
});
it("fails closed when rebuilt JavaScript differs from the published image", () => {
	writeFileSync(join(exported, "entry.js"), "different debug ID");
	const result = verify();
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("differs from the published runtime image");
});
it("compares the complete set of JavaScript paths", () => {
	writeFileSync(join(runtime, "extra.js"), "runtime only");
	expect(verify().status).toBe(1);
});
it("rejects an export without maps", () => {
	rmSync(join(exported, "entry.js.map"));
	expect(verify().status).toBe(1);
});
it("rejects maps in the runtime image", () => {
	writeFileSync(join(runtime, "entry.js.map"), "map");
	expect(verify().status).toBe(1);
});
