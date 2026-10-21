import fsPromises, {
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
import { afterEach, expect, it, vi } from "vitest";
import { expireLogFiles, trimLogFile } from "./logger";

const hour = 60 * 60 * 1000;
const now = Date.parse("2026-10-21T12:00:00Z");
const cutoff = now - 14 * 24 * hour + hour;
const session = "server-2026-10-01T00-00-00-000Z.ndjson";
let directory: string;
afterEach(async () => {
	vi.restoreAllMocks();
	if (directory) await rm(directory, { recursive: true, force: true });
});

it.each([false, true])(
	"removes old entries despite recent mtime (active: %s)",
	async (active) => {
		directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
		const file = path.join(directory, session);
		const recent = JSON.stringify({ time: now, msg: "recent" });
		await writeFile(
			file,
			`${JSON.stringify({ time: now - 20 * 24 * hour })}\n${recent}\n`,
		);
		await utimes(file, new Date(now), new Date(now));
		await expireLogFiles(directory, now, active ? file : undefined);
		expect(await readFile(file, "utf8")).toBe(`${recent}\n`);
	},
);

it("applies the one-hour safety margin and removes active entries on the next hourly job", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, session);
	const recent = JSON.stringify({ time: cutoff + 1 });
	await writeFile(
		file,
		`${JSON.stringify({ time: cutoff - 1 })}\n${JSON.stringify({ time: cutoff })}\n${recent}\n`,
	);
	await expireLogFiles(directory, now, file);
	expect(await readFile(file, "utf8")).toBe(`${recent}\n`);
	await expireLogFiles(directory, now + hour, file);
	expect(await readFile(file, "utf8")).toBe("");
});

it.each([
	[false, false],
	[false, true],
	[true, false],
	[true, true],
])(
	"uses session start despite fresh mtime for malformed or untimestamped lines (active: %s, expired: %s)",
	async (active, expired) => {
		directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
		const sessionId = new Date(expired ? cutoff - 1 : cutoff + 1)
			.toISOString()
			.replace(/[:.]/g, "-");
		const file = path.join(directory, `server-${sessionId}.ndjson`);
		const unknown = [
			"not json",
			"null",
			JSON.stringify({ msg: "no time" }),
			JSON.stringify({ time: String(cutoff - 1) }),
			JSON.stringify({ nested: { time: cutoff - 1 } }),
		];
		const recent = JSON.stringify({ time: now });
		await writeFile(file, `${[...unknown, recent].join("\n")}\n`);
		const modified = new Date(now);
		await utimes(file, modified, modified);
		await expireLogFiles(directory, now, active ? file : undefined);
		expect(await readFile(file, "utf8")).toBe(
			`${(expired ? [recent] : [...unknown, recent]).join("\n")}\n`,
		);
	},
);

it.each([false, true])(
	"falls back to mtime when the session timestamp cannot be parsed (expired: %s)",
	async (expired) => {
		directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
		const file = path.join(directory, "server-2026-13-01T00-00-00-000Z.ndjson");
		const data = 'not json\n{"msg":"no time"}\n';
		await writeFile(file, data);
		const modified = new Date(expired ? cutoff : now);
		await utimes(file, modified, modified);
		await expireLogFiles(directory, now, file);
		expect(await readFile(file, "utf8")).toBe(expired ? "" : data);
	},
);

it("keeps the last 10,000 lines independently of age", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, session);
	const lines = Array.from({ length: 10001 }, (_, index) =>
		JSON.stringify({ time: index, msg: String(index) }),
	);
	await writeFile(file, `${lines.join("\n")}\n`);
	await trimLogFile(file);
	expect(await readFile(file, "utf8")).toBe(`${lines.slice(1).join("\n")}\n`);
});

it("does not rewrite below the line cap, including old entries", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, session);
	const data = `${JSON.stringify({ time: 0 })}\r\n\r\n`;
	await writeFile(file, data);
	const modified = new Date(0);
	await utimes(file, modified, modified);
	await trimLogFile(file);
	expect(await readFile(file, "utf8")).toBe(data);
	expect((await stat(file)).mtimeMs).toBe(modified.getTime());
});

it("does not rewrite during age expiry when all entries are retained", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, session);
	const data = `${JSON.stringify({ time: now })}\r\n\r\n`;
	await writeFile(file, data);
	const modified = new Date(now - 1000);
	await utimes(file, modified, modified);
	await expireLogFiles(directory, now, file);
	expect(await readFile(file, "utf8")).toBe(data);
	expect((await stat(file)).mtimeMs).toBe(modified.getTime());
});

it("empties an expired active destination without replacing its open inode", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const file = path.join(directory, session);
	await writeFile(file, `${JSON.stringify({ time: 0 })}\n`);
	const inode = (await stat(file)).ino;
	await expireLogFiles(directory, now, file);
	expect(await readFile(file, "utf8")).toBe("");
	expect((await stat(file)).ino).toBe(inode);
});

it("continues expiring inactive files after a file cannot be statted", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	for (const name of [session, "server-2026-10-02T00-00-00-000Z.ndjson"])
		await writeFile(
			path.join(directory, name),
			`${JSON.stringify({ time: 0 })}\n`,
		);
	const error = Object.assign(new Error("Permission denied"), {
		code: "EACCES",
	});
	const statSpy = vi.spyOn(fsPromises, "stat").mockRejectedValueOnce(error);
	const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

	await expireLogFiles(directory, now);

	expect(statSpy).toHaveBeenCalledTimes(2);
	expect(await readdir(directory)).toEqual([
		path.basename(statSpy.mock.calls[0][0] as string),
	]);
	expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
		"Failed to expire server log files",
		error,
	);
});

it("deletes empty inactive files and preserves unrelated files, symlinks and directories", async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), "infinitune-logs-"));
	const expired = session;
	const empty = "server-2026-10-02T00-00-00-000Z.ndjson";
	const recent = "server-2026-10-20T00-00-00-000Z.ndjson";
	const unrelated = "unrelated.ndjson";
	for (const [name, data] of [
		[expired, JSON.stringify({ time: 0 })],
		[empty, ""],
		[recent, JSON.stringify({ time: now })],
		[unrelated, "log"],
	] as const)
		await writeFile(path.join(directory, name), data);
	const subdirectory = "server-2026-09-02T00-00-00-000Z.ndjson";
	const link = "server-2026-09-03T00-00-00-000Z.ndjson";
	await mkdir(path.join(directory, subdirectory));
	await symlink(path.join(directory, unrelated), path.join(directory, link));
	await expireLogFiles(directory, now);
	expect((await readdir(directory)).sort()).toEqual(
		[recent, unrelated, subdirectory, link].sort(),
	);
	await expect(
		expireLogFiles(path.join(directory, "missing"), now),
	).resolves.toBeUndefined();
});
