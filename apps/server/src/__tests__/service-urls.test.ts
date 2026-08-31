import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAll, warn } = vi.hoisted(() => ({
	getAll: vi.fn(),
	warn: vi.fn(),
}));

vi.mock("../logger", () => ({
	logger: { warn },
}));

vi.mock("../services/settings-service", () => ({
	getAll,
}));

describe("service URL warnings", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("OLLAMA_URL", "");
		vi.stubEnv("ACE_STEP_URL", "");
		getAll.mockReset();
		warn.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the Windows ACE-Step service when no override is configured", async () => {
		const { DEFAULT_ACE_STEP_URL, getServiceUrls } = await import(
			"../external/service-urls"
		);
		getAll.mockResolvedValue({});

		await expect(getServiceUrls()).resolves.toEqual({
			ollamaUrl: "",
			aceStepUrl: DEFAULT_ACE_STEP_URL,
		});
		expect(DEFAULT_ACE_STEP_URL).toBe("http://192.168.10.242:8001");
	});

	it("prefers ACE_STEP_URL over the persisted setting", async () => {
		vi.stubEnv("ACE_STEP_URL", "http://ace-from-env:8001");
		const { getServiceUrls } = await import("../external/service-urls");
		getAll.mockResolvedValue({
			ollamaUrl: "http://ollama",
			aceStepUrl: "http://ace-from-db:8001",
		});

		await expect(getServiceUrls()).resolves.toMatchObject({
			aceStepUrl: "http://ace-from-env:8001",
		});
	});

	it("preserves a persisted ACE URL when ACE_STEP_URL is empty", async () => {
		const { getServiceUrls } = await import("../external/service-urls");
		getAll.mockResolvedValue({
			ollamaUrl: "http://ollama",
			aceStepUrl: "http://custom-ace-from-db:8001",
		});

		await expect(getServiceUrls()).resolves.toMatchObject({
			aceStepUrl: "http://custom-ace-from-db:8001",
		});
	});

	it("warns once when the optional Ollama URL is missing", async () => {
		const { getServiceUrls } = await import("../external/service-urls");
		getAll
			.mockResolvedValueOnce({ ollamaUrl: "", aceStepUrl: "http://ace" })
			.mockResolvedValueOnce({ ollamaUrl: "http://ollama", aceStepUrl: "" })
			.mockResolvedValueOnce({ ollamaUrl: "", aceStepUrl: "" });

		await getServiceUrls();
		await getServiceUrls();
		await getServiceUrls();

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls.map(([details]) => details)).toEqual([
			{ missing: ["ollamaUrl"] },
		]);
	});
});
