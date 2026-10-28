import {
	analyticsPath,
	sanitizeProps,
	scrubTelemetry,
	telemetryConfig,
} from "@infinitune/shared/telemetry";
import { describe, expect, it, vi } from "vitest";
import { browserAllowed, createBrowserTracker } from "./browser";

describe("telemetry privacy and gating", () => {
	it("redacts nested credentials, emails, Pangolin identity and query secrets", () => {
		const result = scrubTelemetry({
			request: {
				headers: {
					Authorization: "Bearer private-auth",
					Cookie: "session=private-cookie",
					"Remote-Email": "private@example.com",
					"remote-user": "my-name",
					"x-device-token": "private-device",
				},
				data: { prompt: "private prompt" },
				url: "https://example.com/?token=private-token&key=private-key&secret=private-secret&password=private-password&code=private-code&api_key=private-api",
			},
			message: "private@example.com Bearer private-bearer token=private-inline",
			user: { email: "private@example.com" },
			breadcrumbs: [{ data: { lyrics: "private lyrics" } }],
		});
		expect(JSON.stringify(result)).not.toMatch(
			/private-|private@|my-name|private prompt|private lyrics/,
		);
		expect(JSON.stringify(result)).toContain("[Filtered]");
		expect(
			JSON.stringify(
				scrubTelemetry({
					url: "https://user:private-password@example.com/?email=private%40example.com&%74oken=private-token#private",
					query_string: "email=private%40example.com",
				}),
			),
		).not.toContain("private");
	});

	it("allows only the documented scalar event properties", () => {
		expect(
			sanitizeProps({
				prompt: "private",
				lyrics: "private",
				token: "private",
				prompt_length: 7,
				rating: "up",
				duration_ms: Number.NaN,
			}),
		).toEqual({ prompt_length: 7, rating: "up" });
		expect(
			analyticsPath("https://example.com/share/secret?token=private#private"),
		).toBe("/share/:redacted");
	});

	it("gates missing config, tests and local development", () => {
		expect(telemetryConfig({}).enabled).toBe(false);
		expect(
			telemetryConfig({ NODE_ENV: "test", TELEMETRY_ENABLED: "true" }).enabled,
		).toBe(false);
		expect(
			telemetryConfig({
				NODE_ENV: "production",
				GLITCHTIP_TRACES_SAMPLE_RATE: "9",
			}).tracesSampleRate,
		).toBe(0.1);
		const config = telemetryConfig({ NODE_ENV: "production" });
		for (const context of [
			{ dev: true, webdriver: false, hostname: "example.com" },
			{ dev: false, webdriver: true, hostname: "example.com" },
		])
			expect(browserAllowed(config, context)).toBe(false);
	});

	it("queues at most fifty events, sanitizes and flushes once", () => {
		const track = vi.fn();
		let available = false;
		const tracker = createBrowserTracker(true, () =>
			available ? { track } : undefined,
		);
		for (let i = 0; i < 80; i++)
			tracker.track("song_play", { song_id: "123", prompt: "private" });
		expect(track).not.toHaveBeenCalled();
		available = true;
		tracker.flush();
		tracker.flush();
		expect(track).toHaveBeenCalledTimes(50);
		expect(track).toHaveBeenCalledWith("song_play", { song_id: "123" });
		createBrowserTracker(false, () => ({ track })).track("disabled");
		expect(track).toHaveBeenCalledTimes(50);
	});
});
