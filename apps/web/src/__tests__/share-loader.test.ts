import { describe, expect, it, vi } from "vitest";
import {
	buildApiForwardedFor,
	SHARE_LOAD_TIMEOUT_MS,
	shareFetchInit,
	shareLoadErrorForStatus,
} from "../lib/share-loader";

describe("share loader", () => {
	it("appends the frontend peer to the existing proxy chain", () => {
		expect(buildApiForwardedFor("203.0.113.8, 192.0.2.10", "10.42.0.25")).toBe(
			"203.0.113.8, 192.0.2.10, 10.42.0.25",
		);
		expect(buildApiForwardedFor(undefined, "203.0.113.8")).toBe("203.0.113.8");
	});

	it("does not forward a spoofable chain when the direct peer is unavailable", () => {
		expect(buildApiForwardedFor("203.0.113.8", undefined)).toBeUndefined();
	});

	it("bounds the server-side API request", () => {
		const signal = new AbortController().signal;
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);

		const init = shareFetchInit("203.0.113.8");

		expect(timeout).toHaveBeenCalledWith(SHARE_LOAD_TIMEOUT_MS);
		expect(init.signal).toBe(signal);
		expect(new Headers(init.headers).get("x-forwarded-for")).toBe(
			"203.0.113.8",
		);
		timeout.mockRestore();
	});

	it("distinguishes missing, throttled, and unavailable links", () => {
		expect(shareLoadErrorForStatus(404)).toMatchObject({ status: 404 });
		expect(shareLoadErrorForStatus(429)).toMatchObject({ status: 429 });
		expect(shareLoadErrorForStatus(500)).toMatchObject({ status: 503 });
	});
});
