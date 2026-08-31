import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/endpoints", () => ({
	API_URL: "http://api.test",
}));

describe("server service URL precedence", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("ACE_STEP_URL", "");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	function stubSettings(settings: Record<string, string>) {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(settings)));
	}

	it("uses the Windows ACE-Step fallback when no override exists", async () => {
		stubSettings({});
		const { DEFAULT_ACE_STEP_URL, getServiceUrls } = await import(
			"../lib/server-settings"
		);

		await expect(getServiceUrls()).resolves.toMatchObject({
			aceStepUrl: DEFAULT_ACE_STEP_URL,
		});
		expect(DEFAULT_ACE_STEP_URL).toBe("http://192.168.10.242:8001");
	});

	it("prefers ACE_STEP_URL over the persisted setting", async () => {
		vi.stubEnv("ACE_STEP_URL", "http://ace-from-env:8001");
		stubSettings({ aceStepUrl: "http://ace-from-db:8001" });
		const { getServiceUrls } = await import("../lib/server-settings");

		await expect(getServiceUrls()).resolves.toMatchObject({
			aceStepUrl: "http://ace-from-env:8001",
		});
	});

	it("preserves a persisted ACE URL when ACE_STEP_URL is empty", async () => {
		stubSettings({ aceStepUrl: "http://custom-ace-from-db:8001" });
		const { getServiceUrls } = await import("../lib/server-settings");

		await expect(getServiceUrls()).resolves.toMatchObject({
			aceStepUrl: "http://custom-ace-from-db:8001",
		});
	});
});
