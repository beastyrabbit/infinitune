import type { AuthStorage } from "@mariozechner/pi-coding-agent";
import * as settingsService from "../services/settings-service";
import {
	createPiRuntimeHandles,
	migrateLegacyOpenRouterCredential,
	normalizeOpenRouterApiKey,
} from "./pi-runtime";

const OPENROUTER_PROVIDER = "openrouter";
const LEGACY_OPENROUTER_SETTING = "openrouterApiKey";

export interface OpenRouterAuthStatus {
	configured: boolean;
	source: "stored" | "environment" | "runtime" | "fallback" | null;
}

function normalizeStatusSource(
	source:
		| "stored"
		| "runtime"
		| "environment"
		| "fallback"
		| "models_json_key"
		| "models_json_command"
		| undefined,
): OpenRouterAuthStatus["source"] {
	if (
		source === "stored" ||
		source === "runtime" ||
		source === "environment" ||
		source === "fallback"
	) {
		return source;
	}
	return source ? "fallback" : null;
}

function throwAuthStorageErrors(authStorage: AuthStorage): void {
	const [writeError] = authStorage.drainErrors();
	if (writeError) throw writeError;
}

export async function getOpenRouterAuthStatus(): Promise<OpenRouterAuthStatus> {
	const { authStorage } = createPiRuntimeHandles();
	await migrateLegacyOpenRouterCredential(authStorage);
	const status = authStorage.getAuthStatus(OPENROUTER_PROVIDER);
	return {
		configured: authStorage.hasAuth(OPENROUTER_PROVIDER),
		source: normalizeStatusSource(status.source),
	};
}

export async function saveOpenRouterApiKey(
	apiKey: string,
): Promise<OpenRouterAuthStatus> {
	const normalizedKey = normalizeOpenRouterApiKey(apiKey);

	const { authStorage } = createPiRuntimeHandles();
	authStorage.set(OPENROUTER_PROVIDER, {
		type: "api_key",
		key: normalizedKey,
	});
	authStorage.setRuntimeApiKey(OPENROUTER_PROVIDER, normalizedKey);
	throwAuthStorageErrors(authStorage);
	await settingsService.deleteSensitiveSetting(LEGACY_OPENROUTER_SETTING);

	return {
		configured: true,
		source: "stored",
	};
}

export async function clearOpenRouterApiKey(): Promise<OpenRouterAuthStatus> {
	await settingsService.deleteSensitiveSetting(LEGACY_OPENROUTER_SETTING);
	const { authStorage } = createPiRuntimeHandles();
	authStorage.removeRuntimeApiKey(OPENROUTER_PROVIDER);
	authStorage.remove(OPENROUTER_PROVIDER);
	throwAuthStorageErrors(authStorage);

	const status = authStorage.getAuthStatus(OPENROUTER_PROVIDER);
	return {
		configured: authStorage.hasAuth(OPENROUTER_PROVIDER),
		source: normalizeStatusSource(status.source),
	};
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
	const { authStorage } = createPiRuntimeHandles();
	await migrateLegacyOpenRouterCredential(authStorage);
	return await authStorage.getApiKey(OPENROUTER_PROVIDER);
}
