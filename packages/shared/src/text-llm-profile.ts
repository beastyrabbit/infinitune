import type { LlmProvider } from "./types";

export const DEFAULT_TEXT_PROVIDER: LlmProvider = "openai-codex";
export const DEFAULT_OPENAI_CODEX_TEXT_MODEL = "gpt-5.2";
export const DEFAULT_ANTHROPIC_TEXT_MODEL = "claude-sonnet-4-6";
export const PROMPT_OPTIMIZATION_PROVIDER: LlmProvider = "openai-codex";
export const PROMPT_OPTIMIZATION_MODEL = "gpt-5.2";

export function normalizeLlmProvider(
	value?: string | null,
	fallback: LlmProvider = DEFAULT_TEXT_PROVIDER,
): LlmProvider {
	if (!value) return fallback;
	if (value === "openai-codex" || value === "anthropic") {
		return value;
	}
	if (value === "ollama" || value === "openrouter") return "openai-codex";
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

	if (provider === "openai-codex") {
		return { provider, model: DEFAULT_OPENAI_CODEX_TEXT_MODEL };
	}

	return {
		provider,
		model: DEFAULT_ANTHROPIC_TEXT_MODEL,
	};
}
