import { describe, expect, it, vi } from "vitest";
import { EndpointQueues } from "./queues";

describe("OpenRouter worker queue", () => {
	it("uses five LLM slots for OpenRouter", async () => {
		const queues = new EndpointQueues(vi.fn());
		queues.refreshAll({
			textProvider: "openrouter",
			imageProvider: "inference-sh",
		});

		let started = 0;
		const requests = Array.from({ length: 6 }, (_, index) =>
			queues.llm.enqueue({
				songId: `song-${index}`,
				priority: index,
				execute: async (signal) => {
					started++;
					return await new Promise<never>((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => reject(new Error("Cancelled")),
							{ once: true },
						);
					});
				},
			}),
		);
		const settled = Promise.allSettled(requests);

		await vi.waitFor(() => {
			expect(started).toBe(5);
			expect(queues.llm.getStatus()).toMatchObject({ active: 5, pending: 1 });
		});

		for (let index = 0; index < 6; index++) {
			queues.cancelAllForSong(`song-${index}`);
		}
		await settled;
	});
});
