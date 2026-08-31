import { normalizeAgentReasoningLevel } from "@infinitune/shared/agent-reasoning";
import { normalizeImageProvider } from "@infinitune/shared/inference-sh-image-models";
import { normalizeLlmProvider } from "@infinitune/shared/text-llm-profile";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { settings } from "../db/schema";
import { emit } from "../events/event-bus";

const OPENROUTER_CREDENTIAL_OWNER_KEY = "openrouterCredentialOwnerUserId";
const SENSITIVE_SETTING_KEYS = new Set([
	"openrouterApiKey",
	OPENROUTER_CREDENTIAL_OWNER_KEY,
]);

export type OpenRouterCredentialOwnerClaim =
	| { status: "owner"; claimed: boolean }
	| { status: "other"; claimed: false };

export function isSensitiveSettingKey(key: string): boolean {
	return SENSITIVE_SETTING_KEYS.has(key);
}

function redactSensitiveSettings(
	values: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).filter(([key]) => !isSensitiveSettingKey(key)),
	);
}

export async function getAll(): Promise<Record<string, string>> {
	const cached = readCache();
	if (cached) return redactSensitiveSettings(cached);
	const rows = await db.select().from(settings);
	const all = Object.fromEntries(rows.map((s) => [s.key, s.value]));
	writeCache(all);
	return redactSensitiveSettings(all);
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
	if (isSensitiveSettingKey(key)) return null;
	const all = await getAll();
	return Object.hasOwn(all, key) ? all[key] : null;
}

export async function getOpenRouterCredentialOwnerUserId(): Promise<
	string | null
> {
	const [row] = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, OPENROUTER_CREDENTIAL_OWNER_KEY))
		.limit(1);
	return row?.value ?? null;
}

export async function claimOpenRouterCredentialOwner(
	userId: string,
): Promise<OpenRouterCredentialOwnerClaim> {
	if (!userId) throw new Error("OpenRouter credential owner must not be empty");

	const inserted = await db
		.insert(settings)
		.values({ key: OPENROUTER_CREDENTIAL_OWNER_KEY, value: userId })
		.onConflictDoNothing({ target: settings.key })
		.returning({ value: settings.value });

	if (inserted.length > 0) {
		invalidateCache();
		return { status: "owner", claimed: true };
	}

	return (await getOpenRouterCredentialOwnerUserId()) === userId
		? { status: "owner", claimed: false }
		: { status: "other", claimed: false };
}

export async function migrateSensitiveSetting(
	key: string,
	writeReplacement: (value: string) => void | Promise<void>,
): Promise<boolean> {
	if (!isSensitiveSettingKey(key)) {
		throw new Error(`Setting "${key}" is not registered as sensitive`);
	}
	const [row] = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, key))
		.limit(1);
	if (!row) return false;

	await writeReplacement(row.value);
	await db.delete(settings).where(eq(settings.key, key));
	invalidateCache();
	return true;
}

export async function deleteSensitiveSetting(key: string): Promise<void> {
	if (!isSensitiveSettingKey(key)) {
		throw new Error(`Setting "${key}" is not registered as sensitive`);
	}
	await db.delete(settings).where(eq(settings.key, key));
	invalidateCache();
}

export async function set(key: string, value: string) {
	if (isSensitiveSettingKey(key)) {
		throw new Error(
			`Sensitive setting "${key}" must use its dedicated credential endpoint`,
		);
	}
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
