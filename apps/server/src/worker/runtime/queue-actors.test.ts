import { describe, expect, it, vi } from "vitest";
import { AudioQueue, RequestResponseQueue } from "./queue-actors";

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error?: unknown): void;
}

function createDeferred<T>(): Deferred<T> & { resolve(value: T): void } {
	let resolve!: Deferred<T>["resolve"];
	let reject!: Deferred<T>["reject"];
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {
		promise,
		resolve,
		reject,
	};
}

describe("queue actors", () => {
	describe("RequestResponseQueue", () => {
		it("executes pending items by priority, then FIFO for ties", async () => {
			const queue = new RequestResponseQueue<number>("llm", 1);
			const activeGate = createDeferred<number>();
			const order: string[] = [];

			const active = queue.enqueue({
				songId: "active",
				priority: 10,
				execute: async () => {
					await activeGate.promise;
					return 1;
				},
			});
			const p2 = queue.enqueue({
				songId: "second",
				priority: 1,
				execute: async () => {
					order.push("second");
					return 2;
				},
			});
			const p3 = queue.enqueue({
				songId: "third",
				priority: 1,
				execute: async () => {
					order.push("third");
					return 3;
				},
			});

			activeGate.resolve(99);
			await active;
			await Promise.all([p2, p3]);

			expect(order).toEqual(["second", "third"]);
		});

		it("honors reprioritization before dequeue", async () => {
			const long = createDeferred<number>();
			const queue = new RequestResponseQueue<number>("llm", 1);
			const order: string[] = [];

			const active = queue.enqueue({
				songId: "active",
				priority: 1,
				execute: async () => {
					return long.promise;
				},
			});
			const pendingLate = queue.enqueue({
				songId: "pending-late",
				priority: 20,
				execute: async () => {
					order.push("pending-late");
					return 1;
				},
			});
			const pendingEarly = queue.enqueue({
				songId: "pending-early",
				priority: 20,
				execute: async () => {
					order.push("pending-early");
					return 2;
				},
			});

			queue.updatePendingPriority("pending-late", 0);
			queue.resortPending();

			long.resolve(99);
			await active;
			await Promise.all([pendingLate, pendingEarly]);

			expect(order).toEqual(["pending-late", "pending-early"]);
		});
	});

	describe("AudioQueue", () => {
		it("rejects active item and advances pending item on song cancel", async () => {
			const pollAudio = vi.fn(async () => {
				return {
					status: "succeeded" as const,
					audioPath: "/tmp/task-audio.mp3",
				};
			});

			const holdActiveSubmit = new Promise<never>(() => {
				// Never resolves to mimic a hung submission.
			});
			const executeA = vi.fn(async () => holdActiveSubmit);
			const executeB = vi.fn(async () => ({
				taskId: "task-b",
				status: "running" as const,
				submitProcessingMs: 1,
			}));
			const queue = new AudioQueue(pollAudio);

			const first = queue.enqueue({
				songId: "song-a",
				priority: 1,
				execute: executeA,
			});
			const second = queue.enqueue({
				songId: "song-b",
				priority: 2,
				execute: executeB,
			});

			await Promise.resolve();
			expect(executeA).toHaveBeenCalledOnce();
			expect(executeB).toHaveBeenCalledTimes(0);

			queue.cancelSong("song-a");

			await expect(first).rejects.toThrow("Cancelled");
			await Promise.resolve();
			await queue.tickPolls();

			await expect(second).resolves.toMatchObject({
				result: { status: "succeeded", taskId: "task-b" },
			});
			expect(executeB).toHaveBeenCalledTimes(1);
			expect(pollAudio).toHaveBeenCalledTimes(1);
		});

		it("holds a single active slot", async () => {
			const pollCount = new Map<string, number>();

			const pollAudio = vi.fn(async (taskId: string) => {
				const count = (pollCount.get(taskId) ?? 0) + 1;
				pollCount.set(taskId, count);

				if (taskId === "task-a" && count === 1) {
					return {
						status: "running" as const,
					};
				}
				if (taskId === "task-a" && count === 2) {
					return {
						status: "succeeded" as const,
						audioPath: "/tmp/task-a.mp3",
					};
				}
				if (taskId === "task-b" && count === 1) {
					return {
						status: "succeeded" as const,
						audioPath: "/tmp/task-b.mp3",
					};
				}

				return {
					status: "running" as const,
				};
			});

			const executeA = vi.fn(async () => {
				return {
					taskId: "task-a",
					status: "running" as const,
					submitProcessingMs: 1,
				};
			});
			const executeB = vi.fn(async () => {
				return {
					taskId: "task-b",
					status: "running" as const,
					submitProcessingMs: 1,
				};
			});
			const queue = new AudioQueue(pollAudio);

			const first = queue.enqueue({
				songId: "song-a",
				priority: 1,
				execute: executeA,
			});
			const second = queue.enqueue({
				songId: "song-b",
				priority: 2,
				execute: executeB,
			});

			await Promise.resolve();
			expect(executeA).toHaveBeenCalledOnce();
			expect(executeB).toHaveBeenCalledTimes(0);

			await Promise.resolve();
			await queue.tickPolls();
			await queue.tickPolls();

			await expect(first).resolves.toMatchObject({
				result: { status: "succeeded", taskId: "task-a" },
			});
			expect(executeB).toHaveBeenCalledOnce();
			await queue.tickPolls();
			await expect(second).resolves.toMatchObject({
				result: { status: "succeeded", taskId: "task-b" },
			});
		});
	});
});
