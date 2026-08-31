import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
	piCompleteText: vi.fn(),
	piCompleteObject: vi.fn(),
}));

vi.mock("../external/pi-runtime", () => ({
	piCompleteText: mocks.piCompleteText,
	piCompleteObject: mocks.piCompleteObject,
}));

vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue(null),
}));

import { callLlmObject, callLlmText } from "../external/llm-client";

describe("OpenRouter LLM client", () => {
	beforeEach(() => {
		mocks.piCompleteText.mockReset();
		mocks.piCompleteObject.mockReset();
	});

	it("uses openrouter/auto when the model is empty", async () => {
		mocks.piCompleteText.mockResolvedValue("generated lyrics");

		await expect(
			callLlmText({
				provider: "openrouter",
				model: "  ",
				system: "system",
				prompt: "prompt",
			}),
		).resolves.toBe("generated lyrics");

		expect(mocks.piCompleteText).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "openrouter",
				model: "auto",
			}),
		);
	});

	it("keeps an explicit OpenRouter model for structured output", async () => {
		mocks.piCompleteObject.mockResolvedValue({ title: "Night Drive" });
		const schema = z.object({ title: z.string() });

		await expect(
			callLlmObject({
				provider: "openrouter",
				model: "deepseek/deepseek-v3.2",
				system: "system",
				prompt: "prompt",
				schema,
			}),
		).resolves.toEqual({ title: "Night Drive" });

		expect(mocks.piCompleteObject).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "openrouter",
				model: "deepseek/deepseek-v3.2",
			}),
		);
	});
});
