import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	generateSongMetadata: vi.fn(async (input: unknown) => input),
}));

vi.mock("../external/llm", () => ({
	generateSongMetadata: mocks.generateSongMetadata,
	generatePersonaExtract: vi.fn(),
}));

vi.mock("../external/cover", () => ({
	generateCover: vi.fn(),
}));

vi.mock("../external/ace", () => ({
	batchPollAce: vi.fn(),
	pollAce: vi.fn(),
	submitToAce: vi.fn(),
}));

import { createProviderCapability } from "../worker/runtime/provider-registry";

describe("provider registry", () => {
	it("preserves V2 manager slot guidance for metadata generation", async () => {
		const capability = createProviderCapability();
		await capability.generateMetadata({
			prompt: "popular source song reimagining",
			provider: "openai-codex",
			model: "gpt-5.2",
			managerSlot: {
				slot: 3,
				laneId: "global-hits",
				preservedAnchors: ["real famous source song"],
				variationMoves: ["change genre to eurobeat"],
				sonicFocus: "high energy synth bass",
				lyricFocus: "preserve source-song story beats",
				captionFocus: "eurobeat drums and bright synths",
				energyTarget: "high",
				noveltyTarget: "medium",
				avoidPatterns: ["invented source songs"],
				transitionIntent: "rotate source and genre",
				topicHint: "globally known hit",
				lyricTheme: "recognizable original arc",
			},
		});

		expect(mocks.generateSongMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				managerSlot: expect.objectContaining({
					laneId: "global-hits",
					preservedAnchors: ["real famous source song"],
					variationMoves: ["change genre to eurobeat"],
					sonicFocus: "high energy synth bass",
					lyricFocus: "preserve source-song story beats",
					captionFocus: "eurobeat drums and bright synths",
					noveltyTarget: "medium",
					avoidPatterns: ["invented source songs"],
				}),
			}),
		);
	});
});
