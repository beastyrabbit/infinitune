import { logger } from "../logger";
import * as settingsService from "../services/settings-service";

export interface ServiceUrls {
	ollamaUrl: string;
	aceStepUrl: string;
}

export const DEFAULT_ACE_STEP_URL = "http://192.168.10.242:8001";
const envAceStepUrl = process.env.ACE_STEP_URL?.trim() || "";

const defaults: ServiceUrls = {
	ollamaUrl: process.env.OLLAMA_URL || "",
	aceStepUrl: envAceStepUrl || DEFAULT_ACE_STEP_URL,
};

const warnedMissing = new Set<keyof ServiceUrls>();

function warnOnce(missing: Array<keyof ServiceUrls>): void {
	const newlyMissing = missing.filter((key) => !warnedMissing.has(key));
	if (newlyMissing.length === 0) return;
	for (const key of newlyMissing) warnedMissing.add(key);
	logger.warn(
		{ missing: newlyMissing },
		"Service URLs not configured (no DB setting or env var) — calls to these services will fail",
	);
}

export async function getServiceUrls(): Promise<ServiceUrls> {
	try {
		const settings = await settingsService.getAll();
		const persistedAceStepUrl = settings.aceStepUrl?.trim() || "";
		const resolved = {
			ollamaUrl: settings.ollamaUrl || defaults.ollamaUrl,
			aceStepUrl: envAceStepUrl || persistedAceStepUrl || DEFAULT_ACE_STEP_URL,
		};
		const missing = Object.entries(resolved)
			.filter(([, value]) => !value)
			.map(([key]) => key as keyof ServiceUrls);
		if (missing.length > 0) warnOnce(missing);
		return resolved;
	} catch (err) {
		logger.warn({ err }, "Failed to load service URLs from DB, using defaults");
		return defaults;
	}
}

export async function getSetting(key: string): Promise<string | null> {
	try {
		return await settingsService.get(key);
	} catch (err) {
		logger.warn({ err, key }, "Failed to load setting from DB");
		return null;
	}
}
