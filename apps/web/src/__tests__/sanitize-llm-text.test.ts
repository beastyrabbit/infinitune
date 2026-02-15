import { describe, expect, it } from "vitest";
import { sanitizeLlmText } from "../lib/sanitize-llm-text";

describe("sanitizeLlmText", () => {
	it("trims whitespace", () => {
		expect(sanitizeLlmText("  hello  ")).toBe("hello");
	});
	it("strips markdown code fences", () => {
		expect(sanitizeLlmText("```\nsome text\n```")).toBe("some text");
	});
	it("strips surrounding quotes", () => {
		expect(sanitizeLlmText('"quoted text"')).toBe("quoted text");
	});
	it("strips LLM preamble", () => {
		expect(sanitizeLlmText("Here's the enhanced prompt: actual content")).toBe(
			"actual content",
		);
	});
	it("enforces max length", () => {
		expect(sanitizeLlmText("a".repeat(3000), 100)).toBe("a".repeat(100));
	});
	it("passes clean text through unchanged", () => {
		expect(sanitizeLlmText("dark industrial rock with heavy synths")).toBe(
			"dark industrial rock with heavy synths",
		);
	});
});
