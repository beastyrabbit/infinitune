export const SUPPORTED_LYRICS_LANGUAGES = ["english", "german"] as const;

export type SupportedLyricsLanguage =
	(typeof SUPPORTED_LYRICS_LANGUAGES)[number];

/**
 * Normalizes any input into a hard language lock.
 * Null/empty values intentionally resolve to English; callers that want
 * auto-detection should run inferLyricsLanguageFromPrompt() first.
 */
export function normalizeLyricsLanguage(
	value?: string | null,
): SupportedLyricsLanguage {
	if (!value) return "english";
	const normalized = value.trim().toLowerCase();

	if (
		normalized === "german" ||
		normalized === "de" ||
		normalized === "deutsch"
	) {
		return "german";
	}

	if (
		normalized === "english" ||
		normalized === "en" ||
		normalized === "englisch"
	) {
		return "english";
	}

	if (normalized.includes("german") || normalized.includes("deutsch")) {
		return "german";
	}

	return "english";
}

export function inferLyricsLanguageFromPrompt(
	prompt: string,
): SupportedLyricsLanguage {
	const lower = prompt.toLowerCase();

	if (
		/\b(german|deutsch|deutsche|neue deutsche|schlager|berlin)\b/.test(lower)
	) {
		return "german";
	}

	return "english";
}

export function toAceVocalLanguageCode(value?: string | null): "en" | "de" {
	return normalizeLyricsLanguage(value) === "german" ? "de" : "en";
}
