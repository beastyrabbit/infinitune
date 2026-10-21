// @vitest-environment jsdom
import { telemetryConfig } from "@infinitune/shared/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeRecording } from "./recorder";

const config = telemetryConfig({
	NODE_ENV: "production",
	UMAMI_URL: "https://umami.example.com",
	UMAMI_WEBSITE_ID: "id",
	UMAMI_DOMAINS: "localhost",
	GLITCHTIP_DSN: "https://public@example.com/1",
});

describe("browser SDK gating", () => {
	afterEach(() => {
		document.head.innerHTML = "";
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
	it("never loads analytics in dev or without an allowed domain", async () => {
		const { startAnalytics } = await import("./browser");
		startAnalytics(config);
		expect(document.querySelector("script")).toBeNull();
	});
	it("does not import Sentry when the DSN is absent", async () => {
		vi.doMock("@sentry/react", () => {
			throw new Error("SDK must not load");
		});
		const { startBrowserSentry } = await import("./sentry");
		await expect(
			startBrowserSentry({ ...config, dsn: "" }),
		).resolves.toBeUndefined();
	});
	it("loads analytics without consulting a replay policy or starting the recorder", async () => {
		vi.stubEnv("DEV", false);
		const fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				enabled: true,
				replayEnabled: true,
				heatmapEnabled: true,
			}),
		});
		vi.stubGlobal("fetch", fetch);
		const { startAnalytics } = await import("./browser");
		startAnalytics({ ...config, umamiDomains: [location.hostname] });
		const script = document.querySelector("script");
		expect(script?.src).toBe("https://umami.example.com/script.js");
		script?.dispatchEvent(new Event("load"));
		await Promise.resolve();
		expect(fetch).not.toHaveBeenCalled();
		expect([...document.scripts].map((entry) => entry.src)).toEqual([
			"https://umami.example.com/script.js",
		]);
	});
	it("masks replay text, attributes and full URLs independently of server policy", () => {
		const result = sanitizeRecording({
			textContent: "private lyrics",
			attributes: {
				value: "private prompt",
				"data-token": "private token",
				alt: "private name",
				href: "https://music.example.com/share/private?token=private",
			},
			url: "https://music.example.com/?code=private#private",
		});
		expect(JSON.stringify(result)).not.toContain("private");
		expect(result).toMatchObject({
			textContent: "[Masked]",
			url: "https://music.example.com/",
		});
	});
	it.each([
		"data:image/png;base64,private-cover-image",
		"blob:https://music.example.com/private-blob-id",
		"javascript:alert('private')",
		"file:///private/cover.png",
		"mailto:private@example.com",
	])("removes non-HTTP replay URLs: %s", (url) => {
		expect(
			sanitizeRecording({
				url,
				href: url,
				src: url,
				attributes: { src: url, href: url },
			}),
		).toEqual({
			url: "",
			href: "",
			src: "",
			attributes: { src: "", href: "" },
		});
	});
	it.each([
		[
			"http://music.example.com/cover.png?token=private#private",
			"http://music.example.com/cover.png",
		],
		[
			"https://music.example.com/cover.png?token=private#private",
			"https://music.example.com/cover.png",
		],
		[
			"/covers/cover.png?token=private#private",
			`${location.origin}/covers/cover.png`,
		],
	])("keeps sanitized HTTP replay URLs: %s", (url, expected) => {
		expect(sanitizeRecording({ src: url })).toEqual({ src: expected });
	});
});
