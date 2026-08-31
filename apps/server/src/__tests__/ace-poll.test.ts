import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../external/service-urls", () => ({
	getServiceUrls: vi.fn(async () => ({
		aceStepUrl: "http://ace.test",
		ollamaUrl: "http://ollama.test",
	})),
}));

import { ACE_POLL_TIMEOUT_MS, batchPollAce, pollAce } from "../external/ace";

function mockPendingFetch() {
	const fetchMock = vi.fn(
		async (_input: string | URL | Request, init?: RequestInit) => {
			const signal = init?.signal;
			if (!signal) {
				throw new Error("Expected the ACE poll to have an AbortSignal");
			}

			return await new Promise<Response>((_resolve, reject) => {
				const rejectOnAbort = () => reject(signal.reason);
				if (signal.aborted) {
					rejectOnAbort();
					return;
				}
				signal.addEventListener("abort", rejectOnAbort, { once: true });
			});
		},
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("ACE status polling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("times out a never-settling single-task poll", async () => {
		const fetchMock = mockPendingFetch();
		const poll = pollAce("task-1");
		const rejection = expect(poll).rejects.toMatchObject({
			name: "TimeoutError",
		});
		await Promise.resolve();

		expect(fetchMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(ACE_POLL_TIMEOUT_MS);

		await rejection;
		expect(fetchMock.mock.calls[0][1]?.signal).toMatchObject({
			aborted: true,
		});
	});

	it("times out a never-settling batch poll", async () => {
		const fetchMock = mockPendingFetch();
		const poll = batchPollAce(["task-1", "task-2"]);
		const rejection = expect(poll).rejects.toMatchObject({
			name: "TimeoutError",
		});
		await Promise.resolve();

		expect(fetchMock).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(ACE_POLL_TIMEOUT_MS);

		await rejection;
		expect(fetchMock.mock.calls[0][1]?.body).toBe(
			JSON.stringify({ task_id_list: ["task-1", "task-2"] }),
		);
	});

	it("preserves the caller's cancellation reason", async () => {
		const fetchMock = mockPendingFetch();
		const caller = new AbortController();
		const reason = new Error("generation cancelled");
		const poll = pollAce("task-1", caller.signal);
		const rejection = expect(poll).rejects.toBe(reason);
		await Promise.resolve();

		caller.abort(reason);

		await rejection;
		expect(fetchMock.mock.calls[0][1]?.signal?.reason).toBe(reason);
		expect(vi.getTimerCount()).toBe(0);
	});
});
