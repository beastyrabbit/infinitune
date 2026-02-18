import type { LlmProvider } from "./types";

export const DEFAULT_TEXT_PROVIDER: LlmProvider = "ollama";
export const DEFAULT_OLLAMA_TEXT_MODEL = "gpt-oss:20b";
export const PROMPT_OPT_PROVIDER: LlmProvider = "openai-codex";
export const PROMPT_OPT_MODEL = "gpt-5.2";

export function normalizeLlmProvider(
	value?: string | null,
	fallback: LlmProvider = DEFAULT_TEXT_PROVIDER,
): LlmProvider {
	if (!value) return fallback;
	if (
		value === "ollama" ||
		value === "openrouter" ||
		value === "openai-codex"
	) {
		return value;
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

	// Keep existing OpenRouter behavior: no implicit model assignment.
	if (provider === "openrouter") {
		return { provider, model: "" };
	}

	// Codex model selection happens lazily in llm-client through model listing.
	if (provider === "openai-codex") {
		return { provider, model: "" };
	}

	return {
		provider,
		model: DEFAULT_OLLAMA_TEXT_MODEL,
	};
}
