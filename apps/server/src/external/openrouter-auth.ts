import { createHash, timingSafeEqual } from "node:crypto";
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

export interface OpenRouterCredentialStatus extends OpenRouterAuthStatus {
	canManage: boolean;
	setupAllowed: boolean;
	claimRequired: boolean;
	managedExternally: boolean;
}

export class OpenRouterCredentialAccessError extends Error {
	constructor() {
		super("OpenRouter credential management is not available for this user");
		this.name = "OpenRouterCredentialAccessError";
	}
}

export class OpenRouterApiKeyValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OpenRouterApiKeyValidationError";
	}
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

function managementStatus(
	status: OpenRouterAuthStatus,
	ownerUserId: string | null,
	actorUserId: string,
): OpenRouterCredentialStatus {
	const managedExternally = status.configured && status.source !== "stored";
	const canManage = ownerUserId === actorUserId && !managedExternally;
	return {
		...status,
		canManage,
		setupAllowed: !ownerUserId && !status.configured,
		claimRequired:
			!ownerUserId && status.configured && status.source === "stored",
		managedExternally,
	};
}

export async function getOpenRouterCredentialStatus(
	actorUserId: string,
): Promise<OpenRouterCredentialStatus> {
	const [status, ownerUserId] = await Promise.all([
		getOpenRouterAuthStatus(),
		settingsService.getOpenRouterCredentialOwnerUserId(),
	]);
	return managementStatus(status, ownerUserId, actorUserId);
}

export async function getLocalOpenRouterCredentialStatus(): Promise<OpenRouterCredentialStatus> {
	const status = await getOpenRouterAuthStatus();
	return {
		...status,
		canManage: true,
		setupAllowed: !status.configured,
		claimRequired: false,
		managedExternally: false,
	};
}

function storedOpenRouterKeyMatches(apiKey: string): boolean {
	const { authStorage } = createPiRuntimeHandles();
	authStorage.reload();
	const credential = authStorage.get(OPENROUTER_PROVIDER);
	if (credential?.type !== "api_key" || credential.key.startsWith("!")) {
		return false;
	}
	const expected = createHash("sha256").update(credential.key).digest();
	const supplied = createHash("sha256").update(apiKey).digest();
	return timingSafeEqual(expected, supplied);
}

async function requireOwnerClaim(actorUserId: string): Promise<void> {
	const claim =
		await settingsService.claimOpenRouterCredentialOwner(actorUserId);
	if (claim.status !== "owner") throw new OpenRouterCredentialAccessError();
}

export async function saveOpenRouterApiKeyForUser(
	apiKey: string,
	actorUserId: string,
): Promise<OpenRouterCredentialStatus> {
	let normalizedKey: string;
	try {
		normalizedKey = normalizeOpenRouterApiKey(apiKey);
	} catch (error) {
		throw new OpenRouterApiKeyValidationError(
			error instanceof Error ? error.message : "Invalid OpenRouter API key",
		);
	}
	const initial = await getOpenRouterCredentialStatus(actorUserId);

	if (initial.canManage) {
		await saveOpenRouterApiKey(normalizedKey);
		return getOpenRouterCredentialStatus(actorUserId);
	}
	if (initial.setupAllowed) {
		await requireOwnerClaim(actorUserId);
		await saveOpenRouterApiKey(normalizedKey);
		return getOpenRouterCredentialStatus(actorUserId);
	}
	if (initial.claimRequired && storedOpenRouterKeyMatches(normalizedKey)) {
		await requireOwnerClaim(actorUserId);
		return getOpenRouterCredentialStatus(actorUserId);
	}

	throw new OpenRouterCredentialAccessError();
}

export async function clearOpenRouterApiKeyForUser(
	actorUserId: string,
): Promise<OpenRouterCredentialStatus> {
	const initial = await getOpenRouterCredentialStatus(actorUserId);
	if (!initial.canManage) throw new OpenRouterCredentialAccessError();
	await clearOpenRouterApiKey();
	return getOpenRouterCredentialStatus(actorUserId);
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
