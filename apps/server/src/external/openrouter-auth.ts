import { createHash, timingSafeEqual } from "node:crypto";
import * as settingsService from "../services/settings-service";
import {
	createPiCredentialStore,
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

async function readOpenRouterAuthStatus(): Promise<OpenRouterAuthStatus> {
	const { modelRuntime } = await createPiRuntimeHandles();
	const status = modelRuntime.getProviderAuthStatus(OPENROUTER_PROVIDER);
	return {
		configured: status.configured,
		source: normalizeStatusSource(status.source),
	};
}

export async function getOpenRouterAuthStatus(): Promise<OpenRouterAuthStatus> {
	const { credentials } = await createPiCredentialStore();
	await migrateLegacyOpenRouterCredential(credentials);
	return readOpenRouterAuthStatus();
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

async function storedOpenRouterKeyMatches(apiKey: string): Promise<boolean> {
	const { credentials } = await createPiCredentialStore();
	const credential = await credentials.read(OPENROUTER_PROVIDER);
	if (
		credential?.type !== "api_key" ||
		!credential.key ||
		credential.key.startsWith("!")
	) {
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
	if (
		initial.claimRequired &&
		(await storedOpenRouterKeyMatches(normalizedKey))
	) {
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

	const { credentials } = await createPiCredentialStore();
	await credentials.modify(OPENROUTER_PROVIDER, async () => ({
		type: "api_key",
		key: normalizedKey,
	}));
	await settingsService.deleteSensitiveSetting(LEGACY_OPENROUTER_SETTING);

	return {
		configured: true,
		source: "stored",
	};
}

export async function clearOpenRouterApiKey(): Promise<OpenRouterAuthStatus> {
	await settingsService.deleteSensitiveSetting(LEGACY_OPENROUTER_SETTING);
	const { credentials } = await createPiCredentialStore();
	await credentials.delete(OPENROUTER_PROVIDER);
	return readOpenRouterAuthStatus();
}

export async function getOpenRouterApiKey(): Promise<string | undefined> {
	const { credentials } = await createPiCredentialStore();
	await migrateLegacyOpenRouterCredential(credentials);
	const { modelRuntime } = await createPiRuntimeHandles();
	const auth = await modelRuntime.getAuth(OPENROUTER_PROVIDER);
	return auth?.auth.apiKey;
}
