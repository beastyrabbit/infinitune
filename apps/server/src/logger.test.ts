import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { expireLogFiles, trimLogFile } from "./logger";

let directory: string;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

it("drops expired entries from a recently written active file", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, "active.ndjson");
	const now = Date.parse("2026-10-21T12:00:00Z");
	const cutoff = now - 14 * 24 * 60 * 60 * 1000;
	const recent = JSON.stringify({ time: cutoff + 1, msg: "recent" });
	await writeFile(
		file,
		`${JSON.stringify({ time: cutoff - 1 })}\n${recent}\n${JSON.stringify({ time: cutoff })}\n`,
	);
	await utimes(file, new Date(now), new Date(now));
	await trimLogFile(file, now);
	expect(await readFile(file, "utf8")).toBe(`${recent}\n`);
});

it.each([false, true])(
	"uses file age for malformed or untimestamped lines (expired: %s)",
	async (expired) => {
		directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
		const file = path.join(directory, "active.ndjson");
		const now = Date.parse("2026-10-21T12:00:00Z");
		const cutoff = now - 14 * 24 * 60 * 60 * 1000;
		const unknown = [
			"not json",
			"null",
			JSON.stringify({ msg: "no time" }),
			JSON.stringify({ time: String(cutoff - 1) }),
			JSON.stringify({ nested: { time: cutoff - 1 } }),
		];
		const recent = JSON.stringify({ time: now });
		await writeFile(file, `${[...unknown, recent].join("\n")}\n`);
		const modified = new Date(expired ? cutoff : now);
		await utimes(file, modified, modified);
		await trimLogFile(file, now);
		expect(await readFile(file, "utf8")).toBe(
			`${(expired ? [recent] : [...unknown, recent]).join("\n")}\n`,
		);
	},
);

it("keeps the last 10,000 unexpired lines", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, "active.ndjson");
	const now = Date.parse("2026-10-21T12:00:00Z");
	const recent = Array.from({ length: 10001 }, (_, index) =>
		JSON.stringify({ time: now, msg: String(index) }),
	);
	await writeFile(
		file,
		`${recent.join("\n")}\n${JSON.stringify({ time: 0 })}\n`,
	);
	await trimLogFile(file, now);
	expect(await readFile(file, "utf8")).toBe(`${recent.slice(1).join("\n")}\n`);
});

it("does not rewrite a file whose entries are all retained", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, "active.ndjson");
	const now = Date.parse("2026-10-21T12:00:00Z");
	const data = `${JSON.stringify({ time: now })}\r\n\r\n`;
	await writeFile(file, data);
	const modified = new Date(now - 1000);
	await utimes(file, modified, modified);
	await trimLogFile(file, now);
	expect(await readFile(file, "utf8")).toBe(data);
	expect((await stat(file)).mtimeMs).toBe(modified.getTime());
});

it("empties a file when every entry has expired", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, "active.ndjson");
	await writeFile(file, `${JSON.stringify({ time: 0 })}\n`);
	await trimLogFile(file, Date.parse("2026-10-21T12:00:00Z"));
	expect(await readFile(file, "utf8")).toBe("");
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
