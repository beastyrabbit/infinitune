import type { LlmProvider } from "./types";

export const GPT52_TEXT_PROVIDER: LlmProvider = "openrouter";
export const GPT52_TEXT_MODEL = "openai/gpt-5.2";

export function resolveTextLlmProfile(_input?: {
	provider?: string | null;
	model?: string | null;
}): { provider: LlmProvider; model: string } {
	return {
		provider: GPT52_TEXT_PROVIDER,
		model: GPT52_TEXT_MODEL,
	};
}
