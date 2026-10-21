// @vitest-environment jsdom
import { telemetryConfig } from "@infinitune/shared/telemetry";
import { afterEach, describe, expect, it, vi } from "vitest";

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
		const fetch = vi.fn();
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
});
