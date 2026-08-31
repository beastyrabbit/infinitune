import type { Context, Next } from "hono";
import { createRateLimiter } from "./rate-limit";

function envLimit(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function withGlobalCap(
	clientLimiter: ReturnType<typeof createRateLimiter>,
	globalLimiter: ReturnType<typeof createRateLimiter>,
) {
	return async (c: Context, next: Next) => {
		let globalResponse: Awaited<ReturnType<typeof globalLimiter>>;
		const clientResponse = await clientLimiter(c, async () => {
			globalResponse = await globalLimiter(c, next);
		});
		return clientResponse ?? globalResponse;
	};
}

/** Generation-triggering song creation endpoints (ACE audio spend). */
export const generationLimiter = withGlobalCap(
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_GENERATION_PER_MIN", 10),
		windowMs: 60_000,
		prefix: "generation",
	}),
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_GENERATION_GLOBAL_PER_MIN", 100),
		windowMs: 60_000,
		prefix: "generation-global",
		keyBy: () => "all-clients",
		maxBuckets: 1,
	}),
);

/** LLM prompt/enhancement endpoints (LLM spend). */
export const llmLimiter = withGlobalCap(
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_LLM_PER_MIN", 20),
		windowMs: 60_000,
		prefix: "llm",
	}),
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_LLM_GLOBAL_PER_MIN", 200),
		windowMs: 60_000,
		prefix: "llm-global",
		keyBy: () => "all-clients",
		maxBuckets: 1,
	}),
);

/** Radio requests (each may trigger album/song generation). */
export const radioRequestLimiter = withGlobalCap(
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_RADIO_REQUESTS_PER_MIN", 5),
		windowMs: 60_000,
		prefix: "radio-request",
	}),
	createRateLimiter({
		limit: envLimit("RATE_LIMIT_RADIO_REQUESTS_GLOBAL_PER_MIN", 50),
		windowMs: 60_000,
		prefix: "radio-request-global",
		keyBy: () => "all-clients",
		maxBuckets: 1,
	}),
);

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
