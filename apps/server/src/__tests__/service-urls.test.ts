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

	it("warns once for each newly missing URL key", async () => {
		const { getServiceUrls } = await import("../external/service-urls");
		getAll
			.mockResolvedValueOnce({ ollamaUrl: "", aceStepUrl: "http://ace" })
			.mockResolvedValueOnce({ ollamaUrl: "http://ollama", aceStepUrl: "" })
			.mockResolvedValueOnce({ ollamaUrl: "", aceStepUrl: "" });

		await getServiceUrls();
		await getServiceUrls();
		await getServiceUrls();

		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls.map(([details]) => details)).toEqual([
			{ missing: ["ollamaUrl"] },
			{ missing: ["aceStepUrl"] },
		]);
	});
});
