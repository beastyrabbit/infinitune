import {
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	pruneDownloadCache,
	serializeDownloadCacheMutation,
} from "../external/youtube-audio";

function cacheFile(
	directory: string,
	key: string,
	size: number,
	mtime: number,
) {
	const filePath = path.join(directory, `${key}.mp3`);
	writeFileSync(filePath, Buffer.alloc(size));
	utimesSync(filePath, mtime / 1000, mtime / 1000);
	writeFileSync(path.join(directory, `${key}.json`), "{}");
	utimesSync(path.join(directory, `${key}.json`), mtime / 1000, mtime / 1000);
}

describe("reference audio cache pruning", () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), "infinitune-audio-cache-"));
	});

	afterEach(() => rmSync(directory, { recursive: true, force: true }));

	it("removes expired entries before applying the byte quota", () => {
		const now = 2_000_000;
		const expired = "a".repeat(32);
		const current = "b".repeat(32);
		cacheFile(directory, expired, 8, now - 10_000);
		cacheFile(directory, current, 8, now - 100);

		const result = pruneDownloadCache({
			directory,
			maxBytes: 100,
			ttlMs: 1_000,
			now,
		});

		expect(result.removedEntries).toBe(1);
		expect(readdirSync(directory)).toEqual([
			`${current}.json`,
			`${current}.mp3`,
		]);
	});

	it("evicts least-recently-used entries and preserves the active key", () => {
		const now = 2_000_000;
		const oldest = "a".repeat(32);
		const newest = "b".repeat(32);
		const active = "c".repeat(32);
		cacheFile(directory, oldest, 8, now - 300);
		cacheFile(directory, newest, 8, now - 100);
		cacheFile(directory, active, 8, now - 500);

		const result = pruneDownloadCache({
			directory,
			maxBytes: 20,
			ttlMs: 10_000,
			now,
			excludeCacheKey: active,
		});

		expect(result.removedEntries).toBe(1);
		expect(readdirSync(directory)).toEqual([
			`${newest}.json`,
			`${newest}.mp3`,
			`${active}.json`,
			`${active}.mp3`,
		]);
	});

	it("serializes concurrent cache mutations and continues after a failure", async () => {
		let active = 0;
		let maxActive = 0;
		const order: string[] = [];
		const task =
			(name: string, fail = false) =>
			async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				order.push(`${name}:start`);
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(`${name}:end`);
				active--;
				if (fail) throw new Error(name);
				return name;
			};

		const first = serializeDownloadCacheMutation(task("first", true));
		const second = serializeDownloadCacheMutation(task("second"));
		await expect(first).rejects.toThrow("first");
		await expect(second).resolves.toBe("second");

		expect(maxActive).toBe(1);
		expect(order).toEqual([
			"first:start",
			"first:end",
			"second:start",
			"second:end",
		]);
	});
});
