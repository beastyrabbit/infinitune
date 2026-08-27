import { createRateLimiter } from "./rate-limit";

function envLimit(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Generation-triggering song creation endpoints (ACE audio spend). */
export const generationLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_GENERATION_PER_MIN", 10),
	windowMs: 60_000,
	prefix: "generation",
});

/** LLM prompt/enhancement endpoints (LLM spend). */
export const llmLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_LLM_PER_MIN", 20),
	windowMs: 60_000,
	prefix: "llm",
});

/** Radio requests (each may trigger album/song generation). */
export const radioRequestLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_RADIO_REQUESTS_PER_MIN", 5),
	windowMs: 60_000,
	prefix: "radio-request",
});

/** Persistent public-link creation. */
export const shareLinkLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_SHARE_LINKS_PER_MIN", 20),
	windowMs: 60_000,
	prefix: "share-link",
});

/** Anonymous public-share resolution. */
export const shareReadLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_SHARE_READS_PER_MIN", 120),
	windowMs: 60_000,
	prefix: "share-read",
});

/** Global station-preset mutations. */
export const stationPresetLimiter = createRateLimiter({
	limit: envLimit("RATE_LIMIT_STATION_PRESETS_PER_MIN", 30),
	windowMs: 60_000,
	prefix: "station-preset",
});
