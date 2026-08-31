import type { LlmProvider } from "./types";

export const DEFAULT_TEXT_PROVIDER: LlmProvider = "openai-codex";
export const DEFAULT_OPENAI_CODEX_TEXT_MODEL = "gpt-5.2";
export const DEFAULT_OPENROUTER_TEXT_MODEL = "auto";
export const PROMPT_OPTIMIZATION_PROVIDER: LlmProvider = "openai-codex";
export const PROMPT_OPTIMIZATION_MODEL = "gpt-5.2";

export function normalizeLlmProvider(
	value?: string | null,
	fallback: LlmProvider = DEFAULT_TEXT_PROVIDER,
): LlmProvider {
	if (!value) return fallback;
	if (value === "openai-codex" || value === "openrouter") {
		return value;
	}
	// Removed providers still degrade to Codex for stored legacy settings.
	if (value === "anthropic" || value === "ollama") {
		return "openai-codex";
	}
	return fallback;
}

export function resolveTextLlmProfile(input?: {
	provider?: string | null;
	model?: string | null;
}): { provider: LlmProvider; model: string } {
	const provider = normalizeLlmProvider(input?.provider);
	const explicitModel = input?.model?.trim() || "";

	if (explicitModel) {
		return { provider, model: explicitModel };
	}

	return {
		provider,
		model:
			provider === "openrouter"
				? DEFAULT_OPENROUTER_TEXT_MODEL
				: DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	};
}
