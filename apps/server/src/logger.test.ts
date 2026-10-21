import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { expireLogFiles } from "./logger";

let directory: string;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

it("clears an expired active destination without unlinking its open file", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, "server-2026-10-01T00-00-00-000Z.ndjson");
	await writeFile(file, "old log\n");
	await utimes(file, new Date(0), new Date(0));
	await expireLogFiles(directory, Date.now(), file);
	expect(await readFile(file, "utf8")).toBe("");
});

it("expires only server session files at least 14 days since last write", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const now = Date.parse("2026-10-21T12:00:00Z");
	const cutoff = now - 14 * 24 * 60 * 60 * 1000;
	const expired = "server-2026-10-01T00-00-00-000Z.ndjson";
	const boundary = "server-2026-10-07T12-00-00-000Z.ndjson";
	const recent = "server-2026-10-20T00-00-00-000Z.ndjson";
	const active = "server-2026-09-01T00-00-00-000Z.ndjson";
	const unrelated = "unrelated.ndjson";
	for (const [name, modified] of [
		[expired, cutoff - 1],
		[boundary, cutoff],
		[recent, cutoff + 1],
		[active, now],
		[unrelated, cutoff - 1],
	] as const) {
		const file = path.join(directory, name);
		await writeFile(file, "log\n");
		await utimes(file, new Date(modified), new Date(modified));
	}
	const subdirectory = "server-2026-09-02T00-00-00-000Z.ndjson";
	const link = "server-2026-09-03T00-00-00-000Z.ndjson";
	await mkdir(path.join(directory, subdirectory));
	await symlink(path.join(directory, unrelated), path.join(directory, link));
	await expireLogFiles(directory, now);
	expect((await readdir(directory)).sort()).toEqual(
		[recent, active, unrelated, subdirectory, link].sort(),
	);
	await expect(
		expireLogFiles(path.join(directory, "missing"), now),
	).resolves.toBeUndefined();
});
