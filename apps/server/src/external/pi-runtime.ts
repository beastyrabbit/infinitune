import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type Api,
	type AssistantMessage,
	type Context,
	type Credential,
	type Model,
	parseJsonWithRepair,
} from "@earendil-works/pi-ai";
import {
	type CreateAgentSessionOptions,
	createAgentSession,
	createExtensionRuntime,
	ModelRuntime,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	type AgentReasoningLevel,
	getAgentReasoningSettingKey,
	normalizeAgentReasoningLevel,
} from "@infinitune/shared/agent-reasoning";
import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import z, { type ZodType } from "zod";
import {
	type AgentId,
	type AgentModelPolicy,
	getAgentSessionKey,
	getAgentSpec,
	getPiToolAllowlist,
} from "../agents/agent-registry";
import { createAgentTools } from "../agents/tools";
import * as settingsService from "../services/settings-service";
import { FileCredentialStore } from "./pi-credential-store";

const DEFAULT_PI_AGENT_DIR = path.join(os.homedir(), ".infinitune", "pi");
const OPENROUTER_PROVIDER = "openrouter";
const LEGACY_OPENROUTER_SETTING = "openrouterApiKey";
const MAX_OPENROUTER_API_KEY_LENGTH = 4_096;
function getCodexCliAuthPath(): string {
	return path.join(
		process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
		"auth.json",
	);
}

export function getInfinitunePiAgentDir(): string {
	return process.env.INFINITUNE_PI_AGENT_DIR || DEFAULT_PI_AGENT_DIR;
}

export interface PiRuntimeHandles {
	agentDir: string;
	authPath: string;
	modelsJsonPath: string;
	credentials: FileCredentialStore;
	modelRuntime: ModelRuntime;
}

export function normalizeOpenRouterApiKey(apiKey: string): string {
	const normalizedKey = apiKey.trim();
	if (!normalizedKey) {
		throw new Error("OpenRouter API key must not be empty");
	}
	if (normalizedKey.length > MAX_OPENROUTER_API_KEY_LENGTH) {
		throw new Error("OpenRouter API key is too long");
	}
	if (normalizedKey.startsWith("!")) {
		throw new Error("OpenRouter API key must be a literal value");
	}
	return normalizedKey;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function getJwtExpiryMs(token: string): number | null {
	const [, payload] = token.split(".");
	if (!payload) return null;
	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(
			normalized.length + ((4 - (normalized.length % 4)) % 4),
			"=",
		);
		const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
		return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
	} catch {
		return null;
	}
}

function hasUsableOpenAiCodexAuth(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const credential = value as Record<string, unknown>;
	if (credential.type === "api_key" && typeof credential.key === "string") {
		return true;
	}
	return (
		credential.type === "oauth" &&
		typeof credential.access === "string" &&
		typeof credential.refresh === "string" &&
		typeof credential.expires === "number"
	);
}

async function seedPiAuthFromCodexCli(
	credentials: FileCredentialStore,
): Promise<void> {
	await credentials.modify("openai-codex", async (current) => {
		if (hasUsableOpenAiCodexAuth(current)) return current;

		const codexAuth = readJsonObject(getCodexCliAuthPath());
		const tokens =
			codexAuth?.tokens &&
			typeof codexAuth.tokens === "object" &&
			!Array.isArray(codexAuth.tokens)
				? (codexAuth.tokens as Record<string, unknown>)
				: null;
		const access = tokens?.access_token;
		const refresh = tokens?.refresh_token;
		if (typeof access !== "string" || typeof refresh !== "string") {
			return current;
		}

		const accountId = tokens?.account_id;
		const credential: Credential = {
			type: "oauth",
			access,
			refresh,
			expires: getJwtExpiryMs(access) ?? Date.now() - 1,
			...(typeof accountId === "string" ? { accountId } : {}),
		};
		return credential;
	});
}

/** Infinitune's Pi credential store, seeded with the Codex CLI login when Pi has none. */
export async function createPiCredentialStore(): Promise<{
	agentDir: string;
	credentials: FileCredentialStore;
}> {
	const agentDir = getInfinitunePiAgentDir();
	fs.mkdirSync(agentDir, { recursive: true });
	const credentials = new FileCredentialStore(path.join(agentDir, "auth.json"));
	await seedPiAuthFromCodexCli(credentials);
	return { agentDir, credentials };
}

async function createModelRuntime(
	agentDir: string,
	credentials: FileCredentialStore,
): Promise<PiRuntimeHandles> {
	const modelsJsonPath = path.join(agentDir, "models.json");
	// Only the bundled model catalog: no network refresh on every request.
	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: modelsJsonPath,
		allowModelNetwork: false,
	});
	return {
		agentDir,
		authPath: credentials.authPath,
		modelsJsonPath,
		credentials,
		modelRuntime,
	};
}

export async function createPiRuntimeHandles(): Promise<PiRuntimeHandles> {
	const { agentDir, credentials } = await createPiCredentialStore();
	return createModelRuntime(agentDir, credentials);
}

export async function migrateLegacyOpenRouterCredential(
	credentials: FileCredentialStore,
): Promise<void> {
	await settingsService.migrateSensitiveSetting(
		LEGACY_OPENROUTER_SETTING,
		async (legacyKey) => {
			// A key stored meanwhile wins over the legacy setting.
			await credentials.modify(OPENROUTER_PROVIDER, async (current) =>
				current
					? current
					: { type: "api_key", key: normalizeOpenRouterApiKey(legacyKey) },
			);
		},
	);
}

async function createPreparedPiRuntimeHandles(
	provider: LlmProvider,
): Promise<PiRuntimeHandles> {
	const { agentDir, credentials } = await createPiCredentialStore();
	if (provider === OPENROUTER_PROVIDER) {
		await migrateLegacyOpenRouterCredential(credentials);
	}
	return createModelRuntime(agentDir, credentials);
}

function minimalResourceLoader(systemPrompt: string): ResourceLoader {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime: createExtensionRuntime(),
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

export function buildAgentSystemPrompt(agentId: AgentId): string {
	const spec = getAgentSpec(agentId);
	return [
		`You are ${spec.displayName} for Infinitune.`,
		spec.charter,
		"Use only the explicit Infinitune tools made available to you.",
		"Never ask for shell, file, edit, or write access. Coordinate through the playlist channel.",
		"Return concise, structured musical direction. Preserve hard user anchors.",
	].join("\n\n");
}

type PiModelProfile = {
	provider: LlmProvider;
	model: string;
};

const OPENAI_CODEX_PROVIDER = "openai-codex";

/**
 * Find a model in Pi's catalog. The Codex model list in the settings UI comes
 * live from the ChatGPT backend and can name models (such as retired or brand
 * new ones) that Pi's bundled catalog lacks; those reuse the metadata of the
 * catalog Codex model with the fewest optional capabilities, so Pi never
 * enables a feature the requested model may not support.
 */
function findModel(
	modelRuntime: ModelRuntime,
	provider: string,
	modelId: string,
): Model<Api> | undefined {
	const model = modelRuntime.getModel(provider, modelId);
	if (model || provider !== OPENAI_CODEX_PROVIDER) return model;
	const [template] = [...modelRuntime.getModels(OPENAI_CODEX_PROVIDER)].sort(
		(a, b) =>
			Object.keys(a.compat ?? {}).length - Object.keys(b.compat ?? {}).length,
	);
	return template ? { ...template, id: modelId, name: modelId } : undefined;
}

function resolveModel(
	modelRuntime: ModelRuntime,
	provider: string,
	modelId: string,
): Model<Api> {
	const model = findModel(modelRuntime, provider, modelId);
	if (!model) throw new Error(`Pi model not found: ${provider}/${modelId}`);
	return model;
}

function resolveAgentModel(
	modelRuntime: ModelRuntime,
	modelPolicy: AgentModelPolicy,
	preferred?: PiModelProfile,
): { model: Model<Api>; provider: string; modelId: string } {
	if (preferred?.provider === OPENROUTER_PROVIDER) {
		return {
			model: resolveModel(modelRuntime, preferred.provider, preferred.model),
			provider: preferred.provider,
			modelId: preferred.model,
		};
	}
	const candidates = [preferred, modelPolicy.primary].filter(
		(candidate): candidate is PiModelProfile => !!candidate,
	);
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const key = `${candidate.provider}/${candidate.model}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const model = findModel(modelRuntime, candidate.provider, candidate.model);
		if (model) {
			return {
				model,
				provider: candidate.provider,
				modelId: candidate.model,
			};
		}
	}
	throw new Error(
		`Pi model not found: ${[...seen].join(", ") || "no candidates"}`,
	);
}

type PiSessionOptionsInput = {
	agentId: AgentId;
	scopeId?: string | null;
	customTools?: ToolDefinition[];
	thinkingLevel?: AgentReasoningLevel;
	modelProfile?: PiModelProfile;
};

function buildPiSessionOptions(
	input: PiSessionOptionsInput,
	handles: PiRuntimeHandles,
): CreateAgentSessionOptions {
	const spec = getAgentSpec(input.agentId);
	const sessionKey = getAgentSessionKey(input.agentId, input.scopeId);
	const sessionDir = path.join(handles.agentDir, "sessions", sessionKey);
	const tools = getPiToolAllowlist(input.agentId);
	const resolvedModel = resolveAgentModel(
		handles.modelRuntime,
		spec.modelPolicy,
		input.modelProfile,
	);
	return {
		cwd: process.cwd(),
		agentDir: handles.agentDir,
		model: resolvedModel.model,
		thinkingLevel: input.thinkingLevel ?? spec.modelPolicy.thinkingLevel,
		modelRuntime: handles.modelRuntime,
		resourceLoader: minimalResourceLoader(
			buildAgentSystemPrompt(input.agentId),
		),
		sessionManager:
			spec.runtime === "pi-session"
				? SessionManager.continueRecent(process.cwd(), sessionDir)
				: SessionManager.inMemory(process.cwd()),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: true },
			retry: { enabled: true, maxRetries: 2 },
			defaultProvider: resolvedModel.provider,
			defaultModel: resolvedModel.modelId,
		}),
		noTools: "builtin" as const,
		tools,
		customTools: input.customTools ?? createAgentTools(input.agentId),
	};
}

export async function createPiSessionOptions(input: PiSessionOptionsInput) {
	return buildPiSessionOptions(input, await createPiRuntimeHandles());
}

export async function getInfinituneAgentReasoningLevel(
	agentId: AgentId,
): Promise<AgentReasoningLevel> {
	const spec = getAgentSpec(agentId);
	const configured = await settingsService
		.get(getAgentReasoningSettingKey(agentId))
		.catch(() => null);
	return normalizeAgentReasoningLevel(
		configured,
		spec.modelPolicy.thinkingLevel,
	);
}

export async function createInfinituneAgentSession(input: {
	agentId: AgentId;
	scopeId?: string | null;
	customTools?: ToolDefinition[];
	modelProfile?: PiModelProfile;
}) {
	const [thinkingLevel, settings] = await Promise.all([
		getInfinituneAgentReasoningLevel(input.agentId),
		settingsService.getAll().catch((): Record<string, string> => ({})),
	]);
	const modelProfile =
		input.modelProfile ??
		resolveTextLlmProfile({
			provider: settings.textProvider,
			model: settings.textModel,
		});
	const handles = await createPreparedPiRuntimeHandles(modelProfile.provider);
	return await createAgentSession(
		buildPiSessionOptions({ ...input, thinkingLevel, modelProfile }, handles),
	);
}

export async function promptInfinituneAgent(input: {
	agentId: AgentId;
	scopeId?: string | null;
	prompt: string;
	customTools?: ToolDefinition[];
	modelProfile?: PiModelProfile;
	signal?: AbortSignal;
}): Promise<string> {
	const { session } = await createInfinituneAgentSession(input);
	let text = "";
	session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			text += event.assistantMessageEvent.delta;
		}
	});
	try {
		await session.bindExtensions({});
		if (input.signal?.aborted) {
			throw abortSignalError(input.signal);
		}
		if (input.signal) {
			await new Promise<void>((resolve, reject) => {
				const promptPromise = session.prompt(input.prompt);
				const onAbort = () => {
					session.dispose();
					reject(abortSignalError(input.signal));
				};
				input.signal?.addEventListener("abort", onAbort, { once: true });
				promptPromise.then(resolve, reject).finally(() => {
					input.signal?.removeEventListener("abort", onAbort);
				});
			});
		} else {
			await session.prompt(input.prompt);
		}
		return text.trim();
	} finally {
		session.dispose();
	}
}

function abortSignalError(signal?: AbortSignal): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	return new Error("Pi agent prompt aborted");
}

function extractText(message: AssistantMessage): string {
	return message.content
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim();
}

export async function piCompleteText(input: {
	provider: LlmProvider;
	model: string;
	system: string;
	prompt: string;
	temperature?: number;
	reasoning?: AgentReasoningLevel;
	signal?: AbortSignal;
}): Promise<string> {
	const handles = await createPreparedPiRuntimeHandles(input.provider);
	const model = resolveModel(handles.modelRuntime, input.provider, input.model);
	if (!(await handles.modelRuntime.getAuth(model))) {
		throw new Error(`No Pi credentials configured for ${input.provider}`);
	}
	const context: Context = {
		systemPrompt: input.system,
		messages: [
			{
				role: "user",
				content: input.prompt,
				timestamp: Date.now(),
			},
		],
	};
	const message = await handles.modelRuntime.completeSimple(model, context, {
		...(model.reasoning ? {} : { temperature: input.temperature }),
		reasoning: model.reasoning ? (input.reasoning ?? "medium") : undefined,
		signal: input.signal,
	});
	if (message.stopReason === "error") {
		throw new Error(message.errorMessage ?? "Pi text completion failed");
	}
	return extractText(message);
}

function parseJsonFromText(text: string): unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1].trim() : trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start >= 0 && end > start) {
		return parseJsonWithRepair(candidate.slice(start, end + 1));
	}
	return parseJsonWithRepair(candidate);
}

export async function piCompleteObject<T>(input: {
	provider: LlmProvider;
	model: string;
	system: string;
	prompt: string;
	schema: ZodType<T>;
	schemaName?: string;
	temperature?: number;
	reasoning?: AgentReasoningLevel;
	signal?: AbortSignal;
}): Promise<T> {
	const jsonSchema = {
		name: input.schemaName ?? "response",
		schema: z.toJSONSchema(input.schema),
	};
	const text = await piCompleteText({
		provider: input.provider,
		model: input.model,
		system: `${input.system}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
		prompt: input.prompt,
		temperature: input.temperature,
		reasoning: input.reasoning,
		signal: input.signal,
	});
	return input.schema.parse(parseJsonFromText(text));
}
