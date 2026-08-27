import { normalizeAgentReasoningLevel } from "@infinitune/shared/agent-reasoning";
import { normalizeImageProvider } from "@infinitune/shared/inference-sh-image-models";
import { normalizeLlmProvider } from "@infinitune/shared/text-llm-profile";
import { db } from "../db/index";
import { settings } from "../db/schema";
import { emit } from "../events/event-bus";

export async function getAll(): Promise<Record<string, string>> {
	const cached = readCache();
	if (cached) return { ...cached };
	const rows = await db.select().from(settings);
	const all = Object.fromEntries(rows.map((s) => [s.key, s.value]));
	writeCache(all);
	return { ...all };
}

// ─── Short-TTL cache ─────────────────────────────────────────────────
// getAll() is read in hot paths (per-request service URL resolution).
// Writes invalidate immediately; reads fall back to the DB after the TTL.

const CACHE_TTL_MS = 2_000;

let cache: {
	value: Record<string, string>;
	expiresAt: number;
	database: unknown;
} | null = null;

function readCache(): Record<string, string> | null {
	if (!cache || cache.database !== db || Date.now() >= cache.expiresAt)
		return null;
	return cache.value;
}

function writeCache(value: Record<string, string>): void {
	cache = {
		value: { ...value },
		expiresAt: Date.now() + CACHE_TTL_MS,
		database: db,
	};
}

function invalidateCache(): void {
	cache = null;
}

export async function get(key: string): Promise<string | null> {
	return (await getAll())[key] ?? null;
}

export async function set(key: string, value: string) {
	const storedValue =
		key === "textProvider" || key === "personaProvider"
			? normalizeLlmProvider(value)
			: key === "imageProvider"
				? normalizeImageProvider(value)
				: key.startsWith("agentReasoning.")
					? normalizeAgentReasoningLevel(value)
					: value;
	await db
		.insert(settings)
		.values({ key, value: storedValue })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: storedValue },
		});

	invalidateCache();
	emit("settings.changed", { key });
}
