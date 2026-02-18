import process from "node:process";

const DEFAULT_CODEX_LLM_CONCURRENCY = 100;

export const CODEX_LLM_CONCURRENCY = (() => {
	const raw = process.env.CODEX_LLM_CONCURRENCY;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	return DEFAULT_CODEX_LLM_CONCURRENCY;
})();
