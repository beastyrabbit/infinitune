import { telemetryConfig } from "@infinitune/shared/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUmamiSender } from "./umami";

const config = telemetryConfig({
	NODE_ENV: "production",
	UMAMI_URL: "https://umami.example.com",
	UMAMI_WEBSITE_ID: "website",
	UMAMI_DOMAINS: "music.example.com",
});

describe("server Umami sender", () => {
	afterEach(() => vi.useRealTimers());
	it("sends a public event with a matching hostname, non-bot UA and safe props", async () => {
		const transport = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("{}"));
		createUmamiSender(config, transport)("song_generation_started", {
			provider: "ollama",
			prompt: "private",
		});
		await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
		const [url, init] = transport.mock.calls[0];
		expect(url).toBe("https://umami.example.com/api/send");
		expect(JSON.parse(String(init?.body))).toEqual({
			type: "event",
			payload: {
				website: "website",
				hostname: "music.example.com",
				url: "/generation",
				name: "song_generation_started",
				data: { source: "server", provider: "ollama" },
			},
		});
		expect((init?.headers as Record<string, string>)["User-Agent"]).not.toMatch(
			/bot|spider|crawl/i,
		);
	});

	it("is disabled without config or during tests", () => {
		const transport = vi.fn();
		for (const env of [
			{},
			{ NODE_ENV: "test", UMAMI_URL: config.umamiUrl, UMAMI_WEBSITE_ID: "id" },
			{ NODE_ENV: "production" },
		])
			createUmamiSender(telemetryConfig(env), transport)("event");
		expect(transport).not.toHaveBeenCalled();
	});

	it("bounds concurrency, aborts timeouts even for an uncooperative transport, swallows failures", async () => {
		vi.useFakeTimers();
		const transport = vi
			.fn<typeof fetch>()
			.mockImplementation(() => new Promise(() => {}));
		const send = createUmamiSender(config, transport, 100);
		for (let i = 0; i < 50; i++) send("event");
		await vi.advanceTimersByTimeAsync(0);
		expect(transport).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(101);
		expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
		send("event");
		await vi.advanceTimersByTimeAsync(0);
		expect(transport).toHaveBeenCalledTimes(5);
		await vi.advanceTimersByTimeAsync(101);
	});
});
