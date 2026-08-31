import {
	existsSync,
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
	createDownloadCacheCoordinator,
	createDownloadCacheSizeGuard,
	parseYtDlpDownloadOutput,
	pruneDownloadCache,
	serializeDownloadCacheMutation,
} from "../external/youtube-audio";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

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

function testCoordinator(directory: string, maxBytes: number) {
	let coordinator: ReturnType<typeof createDownloadCacheCoordinator>;
	coordinator = createDownloadCacheCoordinator({
		maxBytes,
		reservationBytes: 10,
		cleanup: (cacheKey) => {
			for (const entry of readdirSync(directory)) {
				if (entry.startsWith(`${cacheKey}.`)) {
					rmSync(path.join(directory, entry), { force: true });
				}
			}
		},
		ensureCapacity: (availableBytes, reservedCacheKeys) => {
			const result = pruneDownloadCache({
				directory,
				maxBytes: availableBytes,
				ttlMs: Number.MAX_SAFE_INTEGER,
				excludeCacheKeys: coordinator.protectedCacheKeys(),
				reservedCacheKeys,
			});
			if (result.quotaSizeBytes > availableBytes) {
				throw new Error("cache capacity exceeded");
			}
		},
	});
	return coordinator;
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
		const firstStarted = deferred();
		const releaseFirst = deferred();
		const task =
			(name: string, fail = false) =>
			async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				order.push(`${name}:start`);
				if (name === "first") {
					firstStarted.resolve();
					await releaseFirst.promise;
				}
				order.push(`${name}:end`);
				active--;
				if (fail) throw new Error(name);
				return name;
			};

		const first = serializeDownloadCacheMutation(task("first", true));
		await firstStarted.promise;
		const second = serializeDownloadCacheMutation(task("second"));
		expect(order).toEqual(["first:start"]);
		releaseFirst.resolve();
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

	it("runs distinct download bodies concurrently while preserving reservations", async () => {
		const coordinator = testCoordinator(directory, 20);
		const firstKey = "a".repeat(32);
		const secondKey = "b".repeat(32);
		const thirdKey = "c".repeat(32);
		const bothStarted = deferred();
		const releaseDownloads = deferred();
		let activeBodies = 0;
		let maxActiveBodies = 0;

		const runDownload = (cacheKey: string, fail = false) =>
			coordinator.runDeduplicated(cacheKey, () =>
				coordinator.runReserved(cacheKey, async () => {
					writeFileSync(
						path.join(directory, `${cacheKey}.mp3`),
						Buffer.alloc(4),
					);
					writeFileSync(
						path.join(directory, `${cacheKey}.source`),
						Buffer.alloc(6),
					);
					activeBodies++;
					maxActiveBodies = Math.max(maxActiveBodies, activeBodies);
					if (activeBodies === 2) bothStarted.resolve();
					await releaseDownloads.promise;
					activeBodies--;
					if (fail) throw new Error("simulated download failure");
					return cacheKey;
				}),
			);

		const first = runDownload(firstKey, true);
		const second = runDownload(secondKey);
		await bothStarted.promise;

		expect(maxActiveBodies).toBe(2);
		expect(coordinator.reservedBytes()).toBe(20);
		expect(existsSync(path.join(directory, `${firstKey}.mp3`))).toBe(true);
		expect(existsSync(path.join(directory, `${secondKey}.mp3`))).toBe(true);
		const inFlightUsage = pruneDownloadCache({
			directory,
			maxBytes: 0,
			ttlMs: Number.MAX_SAFE_INTEGER,
			excludeCacheKeys: coordinator.protectedCacheKeys(),
			reservedCacheKeys: coordinator.reservedCacheKeys(),
		});
		expect(inFlightUsage.sizeBytes).toBe(20);
		expect(inFlightUsage.quotaSizeBytes).toBe(0);

		let overQuotaBodyRan = false;
		await expect(
			coordinator.runDeduplicated(thirdKey, () =>
				coordinator.runReserved(thirdKey, async () => {
					overQuotaBodyRan = true;
					return thirdKey;
				}),
			),
		).rejects.toThrow("capacity");
		expect(overQuotaBodyRan).toBe(false);

		releaseDownloads.resolve();
		const [firstResult, secondResult] = await Promise.allSettled([
			first,
			second,
		]);
		expect(firstResult.status).toBe("rejected");
		expect(secondResult).toEqual({ status: "fulfilled", value: secondKey });
		expect(coordinator.reservedBytes()).toBe(0);
		expect(existsSync(path.join(directory, `${firstKey}.mp3`))).toBe(false);

		await expect(
			coordinator.runDeduplicated(thirdKey, () =>
				coordinator.runReserved(thirdKey, async () => {
					writeFileSync(
						path.join(directory, `${thirdKey}.mp3`),
						Buffer.alloc(8),
					);
					return thirdKey;
				}),
			),
		).resolves.toBe(thirdKey);

		expect(coordinator.reservedBytes()).toBe(0);
		expect(readdirSync(directory).sort()).toEqual([
			`${secondKey}.mp3`,
			`${secondKey}.source`,
			`${thirdKey}.mp3`,
		]);
	});

	it("deduplicates concurrent work for the same cache key", async () => {
		const coordinator = testCoordinator(directory, 20);
		const cacheKey = "d".repeat(32);
		const bodyStarted = deferred();
		const releaseDownload = deferred();
		let bodies = 0;
		const task = () =>
			coordinator.runReserved(cacheKey, async () => {
				bodies++;
				bodyStarted.resolve();
				await releaseDownload.promise;
				return cacheKey;
			});

		const first = coordinator.runDeduplicated(cacheKey, task);
		const second = coordinator.runDeduplicated(cacheKey, task);
		expect(first).toBe(second);
		await bodyStarted.promise;
		expect(bodies).toBe(1);

		releaseDownload.resolve();
		await expect(Promise.all([first, second])).resolves.toEqual([
			cacheKey,
			cacheKey,
		]);
		expect(bodies).toBe(1);
	});

	it("parses structured yt-dlp output without trusting title delimiters or paths", () => {
		const cacheKey = "e".repeat(32);
		const expectedPath = path.join(directory, `${cacheKey}.mp3`);
		const externalPath = path.join(directory, "external-existing.mp3");
		writeFileSync(expectedPath, "cache");
		writeFileSync(externalPath, "external");
		const title = "bad\tline\nnext";

		expect(
			parseYtDlpDownloadOutput(
				JSON.stringify({
					duration: 273.6,
					title,
					filepath: expectedPath,
				}),
				expectedPath,
			),
		).toEqual({
			filePath: expectedPath,
			durationSeconds: 273.6,
			title,
		});

		expect(() =>
			parseYtDlpDownloadOutput(
				JSON.stringify({
					duration: 273.6,
					title,
					filepath: externalPath,
				}),
				expectedPath,
			),
		).toThrow("invalid download metadata");
		expect(existsSync(externalPath)).toBe(true);
		expect(() =>
			parseYtDlpDownloadOutput(
				JSON.stringify({
					duration: "273.6",
					title,
					filepath: expectedPath,
				}),
				expectedPath,
			),
		).toThrow("invalid download metadata");
	});

	it("stops an unknown-length download as soon as local artifacts exceed its limits", () => {
		const cacheKey = "f".repeat(32);
		let exceededCalls = 0;
		const guard = createDownloadCacheSizeGuard({
			directory,
			cacheKey,
			maxEntryBytes: 10,
			maxFileBytes: 8,
			onExceeded: () => {
				exceededCalls++;
			},
			intervalMs: 60_000,
		});

		writeFileSync(path.join(directory, `${cacheKey}.source`), Buffer.alloc(9));
		expect(guard.check()).toBe(true);
		expect(guard.exceeded()).toBe(true);
		expect(exceededCalls).toBe(1);

		writeFileSync(path.join(directory, `${cacheKey}.part`), Buffer.alloc(9));
		expect(guard.check()).toBe(true);
		expect(exceededCalls).toBe(1);
		guard.stop();
	});
});
