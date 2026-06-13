import type { LlmProvider } from "./types";

export const DEFAULT_TEXT_PROVIDER: LlmProvider = "openai-codex";
export const DEFAULT_OPENAI_CODEX_TEXT_MODEL = "gpt-5.2";
export const PROMPT_OPTIMIZATION_PROVIDER: LlmProvider = "openai-codex";
export const PROMPT_OPTIMIZATION_MODEL = "gpt-5.2";

export function normalizeLlmProvider(
	value?: string | null,
	fallback: LlmProvider = DEFAULT_TEXT_PROVIDER,
): LlmProvider {
	if (!value) return fallback;
	if (value === "openai-codex") {
		return value;
	}
	// Legacy providers (anthropic, ollama, openrouter) degrade to codex
	if (value === "anthropic" || value === "ollama" || value === "openrouter") {
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

	return { provider, model: DEFAULT_OPENAI_CODEX_TEXT_MODEL };
}
