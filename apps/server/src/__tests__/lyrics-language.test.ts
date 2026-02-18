import {
	inferLyricsLanguageFromPrompt,
	normalizeLyricsLanguage,
	toAceVocalLanguageCode,
} from "@infinitune/shared/lyrics-language";
import { describe, expect, it } from "vitest";

describe("lyrics-language", () => {
	it("defaults empty language input to english lock", () => {
		expect(normalizeLyricsLanguage(undefined)).toBe("english");
		expect(normalizeLyricsLanguage(null)).toBe("english");
		expect(normalizeLyricsLanguage("")).toBe("english");
	});

	it("infers german from german prompt cues", () => {
		expect(inferLyricsLanguageFromPrompt("neue deutsche welle berlin")).toBe(
			"german",
		);
	});

	it("does not infer german from Berlin alone", () => {
		expect(
			inferLyricsLanguageFromPrompt("synth-pop inspired by Berlin nightlife"),
		).toBe("english");
	});

	it("maps normalized language to ACE vocal code", () => {
		expect(toAceVocalLanguageCode("deutsch")).toBe("de");
		expect(toAceVocalLanguageCode("english")).toBe("en");
	});
});
