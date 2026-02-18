import { describe, expect, it } from "vitest";
import {
	getSongPromptContract,
	resolveSongPromptProfile,
} from "../external/llm";

describe("song prompt contract", () => {
	it("returns mode/profile diagnostics with budget metadata", () => {
		const contract = getSongPromptContract("close");

		expect(contract.distance).toBe("close");
		expect(contract.profile).toBe("balanced");
		expect(contract.mode).toBe("full");
		expect(contract.estimatedTokens).toBeGreaterThan(0);
		expect(contract.budget.maxChars).toBeGreaterThan(0);
		expect(Array.isArray(contract.budget.warnings)).toBe(true);
	});

	it("uses compact profile to keep system prompt shorter", () => {
		const full = getSongPromptContract("close", "balanced", "full");
		const compact = getSongPromptContract("close", "compact");

		expect(compact.profile).toBe("compact");
		expect(compact.mode).toBe("minimal");
		expect(compact.systemPrompt.length).toBeLessThan(full.systemPrompt.length);
		expect(compact.systemPrompt).not.toContain(
			"ART STYLE — Pick ONE at random",
		);
	});

	it("supports explicit none mode for diagnostics", () => {
		const contract = getSongPromptContract("general", "creative", "none");

		expect(contract.mode).toBe("none");
		expect(contract.systemPrompt).toContain("Return valid JSON");
	});
});

describe("song prompt profile resolution", () => {
	it("defaults faithful requests to strict profile", () => {
		const profile = resolveSongPromptProfile({
			distance: "faithful",
			prompt: "Write a melodic techno track with clean female vocal",
		});
		expect(profile).toBe("strict");
	});

	it("relaxes faithful strictness when the prompt explicitly asks exploration", () => {
		const profile = resolveSongPromptProfile({
			distance: "faithful",
			prompt:
				"Keep this request but surprise me, experiment, and take creative liberties",
		});
		expect(profile).toBe("balanced");
	});

	it("keeps explicit requested profile when provided", () => {
		const profile = resolveSongPromptProfile({
			distance: "general",
			prompt: "anything in this vibe",
			requestedProfile: "compact",
		});
		expect(profile).toBe("compact");
	});
});
