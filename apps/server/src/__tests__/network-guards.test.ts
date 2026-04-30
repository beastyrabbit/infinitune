import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
	lookup: lookupMock,
}));

import { webFetchUrl } from "../agents/tools/web-tools";
import { _testInferenceSh } from "../external/inference-sh";
import { setPublicHttpRequestOverrideForTests } from "../utils/public-http";

function bufferResponse(
	body: string,
	init?: { status?: number; headers?: Record<string, string> },
) {
	const headers = new Map(
		Object.entries({
			"content-type": "text/plain",
			...(init?.headers ?? {}),
		}).map(([key, value]) => [key.toLowerCase(), value]),
	);
	const status = init?.status ?? 200;
	return {
		response: {
			status,
			ok: status >= 200 && status < 300,
			headers: {
				get(name: string) {
					return headers.get(name.toLowerCase()) ?? null;
				},
			},
		},
		buffer: Buffer.from(body),
	};
}

describe("agent network guards", () => {
	let requestMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		lookupMock.mockReset();
		requestMock = vi.fn();
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			return bufferResponse("");
		});
	});

	afterEach(() => {
		setPublicHttpRequestOverrideForTests(null);
	});

	it("blocks IPv4-mapped private IPv6 DNS answers for web fetch", async () => {
		lookupMock.mockResolvedValue([{ address: "::ffff:127.0.0.1", family: 6 }]);

		await expect(webFetchUrl("https://example.com/page")).rejects.toThrow(
			/private/i,
		);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it("blocks redirects from agent web fetches", async () => {
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			return bufferResponse("", {
				status: 302,
				headers: { location: "/next" },
			});
		});

		await expect(webFetchUrl("https://example.com/page")).rejects.toThrow(
			/redirect/i,
		);
		expect(requestMock).toHaveBeenCalledWith("https://example.com/page", {
			address: "93.184.216.34",
			family: 4,
		});
	});

	it("enforces the web fetch byte limit", async () => {
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			throw new Error("Web fetch response is too large.");
		});

		await expect(webFetchUrl("https://example.com/page")).rejects.toThrow(
			/too large/i,
		);
	});

	it("blocks file URLs returned by Inference.sh", async () => {
		await expect(
			_testInferenceSh.imageReferenceToBase64("file:///etc/passwd"),
		).rejects.toThrow(/file urls/i);
	});

	it("blocks private DNS answers for Inference.sh image URLs", async () => {
		lookupMock.mockResolvedValue([{ address: "10.0.0.2", family: 4 }]);

		await expect(
			_testInferenceSh.imageReferenceToBase64("https://images.example/out.png"),
		).rejects.toThrow(/private/i);
	});

	it("blocks redirects from Inference.sh image URLs", async () => {
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			return bufferResponse("", { status: 302 });
		});

		await expect(
			_testInferenceSh.imageReferenceToBase64("https://images.example/out.png"),
		).rejects.toThrow(/redirect/i);
	});

	it("requires Inference.sh image URL responses to be images", async () => {
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			return bufferResponse("not an image");
		});

		await expect(
			_testInferenceSh.imageReferenceToBase64("https://images.example/out.png"),
		).rejects.toThrow(/did not return an image/i);
	});

	it("enforces the Inference.sh image byte limit", async () => {
		lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		setPublicHttpRequestOverrideForTests(async (url, options) => {
			requestMock(url.toString(), options.resolvedAddress);
			throw new Error("Inference.sh image output is too large");
		});

		await expect(
			_testInferenceSh.imageReferenceToBase64("https://images.example/out.png"),
		).rejects.toThrow(/too large/i);
	});
});
