import { describe, expect, it } from "vitest";
import { assertProductionAppOrigin, selectApiUrls } from "../lib/endpoints";

describe("API URL selection", () => {
	it("keeps browser requests and media URLs on the browser origin", () => {
		expect(
			selectApiUrls({
				browserOrigin: "https://music.example.com/",
				appOrigin: "https://configured.example.com",
				internalApiUrl: "http://api.internal:5175",
			}),
		).toEqual({
			publicApiUrl: "https://music.example.com",
			fetchApiUrl: "https://music.example.com",
		});
	});

	it("uses an explicit Vite API URL for a split browser deployment", () => {
		expect(
			selectApiUrls({
				viteApiUrl: "https://api.example.com/",
				browserOrigin: "https://music.example.com",
			}),
		).toEqual({
			publicApiUrl: "https://api.example.com",
			fetchApiUrl: "https://api.example.com",
		});
	});

	it("uses APP_ORIGIN publicly and INTERNAL_API_URL only for SSR fetches", () => {
		expect(
			selectApiUrls({
				appOrigin: "https://music.example.com/",
				internalApiUrl: "http://api.internal:5175/",
			}),
		).toEqual({
			publicApiUrl: "https://music.example.com",
			fetchApiUrl: "http://api.internal:5175",
		});
	});

	it("falls back to the public SSR origin when no internal URL is set", () => {
		expect(selectApiUrls({ appOrigin: "https://music.example.com" })).toEqual({
			publicApiUrl: "https://music.example.com",
			fetchApiUrl: "https://music.example.com",
		});
	});

	it("retains the local development fallback", () => {
		expect(selectApiUrls({})).toEqual({
			publicApiUrl: "http://localhost:5175",
			fetchApiUrl: "http://localhost:5175",
		});
	});
});

describe("production APP_ORIGIN validation", () => {
	it("allows an origin-only HTTP(S) URL", () => {
		expect(() =>
			assertProductionAppOrigin({
				nodeEnv: "production",
				appOrigin: "https://music.example.com/",
			}),
		).not.toThrow();
	});

	it.each([
		undefined,
		"",
		"music.example.com",
		"https://music.example.com/path",
		"https://music.example.com?",
		"https://user@music.example.com",
	])("rejects an invalid production origin: %s", (appOrigin) => {
		expect(() =>
			assertProductionAppOrigin({ nodeEnv: "production", appOrigin }),
		).toThrow(/APP_ORIGIN must be an absolute HTTP\(S\) origin/);
	});

	it("keeps the local fallback available outside production", () => {
		expect(() =>
			assertProductionAppOrigin({ nodeEnv: "development" }),
		).not.toThrow();
	});
});
