import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type AgentReasoningLevel,
	getAgentReasoningSettingKey,
	normalizeAgentReasoningLevel,
} from "@infinitune/shared/agent-reasoning";
import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import {
	type Api,
	type Context,
	completeSimple,
	type Model,
	parseJsonWithRepair,
} from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	createExtensionRuntime,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
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

const DEFAULT_PI_AGENT_DIR = path.join(os.homedir(), ".infinitune", "pi");
const OPENROUTER_PROVIDER = "openrouter";
const LEGACY_OPENROUTER_SETTING = "openrouterApiKey";
const MAX_OPENROUTER_API_KEY_LENGTH = 4_096;
const CODEX_CLI_AUTH_PATH = path.join(
	process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
	"auth.json",
);

export function getInfinitunePiAgentDir(): string {
	return process.env.INFINITUNE_PI_AGENT_DIR || DEFAULT_PI_AGENT_DIR;
}

export interface PiRuntimeHandles {
	agentDir: string;
	authPath: string;
	modelsJsonPath: string;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
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

function pinStoredOpenRouterKeyAsLiteral(authStorage: AuthStorage): void {
	const credential = authStorage.get(OPENROUTER_PROVIDER);
	if (credential?.type === "api_key") {
		// Pi treats a stored key beginning with `!` as a shell command. A runtime
		// override has higher priority and always returns the exact string, which
		// keeps manually written and pre-fix credentials inert as well.
		authStorage.setRuntimeApiKey(OPENROUTER_PROVIDER, credential.key);
	} else {
		authStorage.removeRuntimeApiKey(OPENROUTER_PROVIDER);
	}
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

function seedPiAuthFromCodexCli(authPath: string): void {
	const piAuth = readJsonObject(authPath) ?? {};
	if (hasUsableOpenAiCodexAuth(piAuth["openai-codex"])) return;

	const codexAuth = readJsonObject(CODEX_CLI_AUTH_PATH);
	const tokens =
		codexAuth?.tokens &&
		typeof codexAuth.tokens === "object" &&
		!Array.isArray(codexAuth.tokens)
			? (codexAuth.tokens as Record<string, unknown>)
			: null;
	const access = tokens?.access_token;
	const refresh = tokens?.refresh_token;
	if (typeof access !== "string" || typeof refresh !== "string") return;

	const accountId = tokens?.account_id;
	piAuth["openai-codex"] = {
		type: "oauth",
		access,
		refresh,
		expires: getJwtExpiryMs(access) ?? Date.now() - 1,
		...(typeof accountId === "string" ? { accountId } : {}),
	};
	fs.writeFileSync(authPath, JSON.stringify(piAuth, null, 2), "utf8");
	try {
		fs.chmodSync(authPath, 0o600);
	} catch {
		// Best effort only; AuthStorage also enforces permissions when it writes.
	}
}

export function createPiRuntimeHandles(): PiRuntimeHandles {
	const agentDir = getInfinitunePiAgentDir();
	fs.mkdirSync(agentDir, { recursive: true });
	const authPath = path.join(agentDir, "auth.json");
	const modelsJsonPath = path.join(agentDir, "models.json");
	seedPiAuthFromCodexCli(authPath);
	const authStorage = AuthStorage.create(authPath);
	pinStoredOpenRouterKeyAsLiteral(authStorage);
	const modelRegistry = ModelRegistry.create(authStorage, modelsJsonPath);
	return { agentDir, authPath, modelsJsonPath, authStorage, modelRegistry };
}

function throwAuthStorageErrors(authStorage: AuthStorage): void {
	const [writeError] = authStorage.drainErrors();
	if (writeError) throw writeError;
}

export async function migrateLegacyOpenRouterCredential(
	authStorage: AuthStorage,
): Promise<void> {
	await settingsService.migrateSensitiveSetting(
		LEGACY_OPENROUTER_SETTING,
		(legacyKey) => {
			authStorage.reload();
			if (authStorage.has(OPENROUTER_PROVIDER)) {
				pinStoredOpenRouterKeyAsLiteral(authStorage);
				return;
			}
			const normalizedKey = normalizeOpenRouterApiKey(legacyKey);
			authStorage.set(OPENROUTER_PROVIDER, {
				type: "api_key",
				key: normalizedKey,
			});
			pinStoredOpenRouterKeyAsLiteral(authStorage);
			throwAuthStorageErrors(authStorage);
		},
	);
}

async function createPreparedPiRuntimeHandles(
	provider: LlmProvider,
): Promise<PiRuntimeHandles> {
	const handles = createPiRuntimeHandles();
	if (provider === OPENROUTER_PROVIDER) {
		await migrateLegacyOpenRouterCredential(handles.authStorage);
	}
	return handles;
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
		getAppendSystemPrompt: () => [],
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

function resolveModel(
	modelRegistry: ModelRegistry,
	provider: string,
	modelId: string,
): Model<Api> {
	const model = modelRegistry.find(provider, modelId);
	if (!model) throw new Error(`Pi model not found: ${provider}/${modelId}`);
	return model as Model<Api>;
}

function resolveAgentModel(
	modelRegistry: ModelRegistry,
	modelPolicy: AgentModelPolicy,
	preferred?: PiModelProfile,
): { model: Model<Api>; provider: string; modelId: string } {
	if (preferred?.provider === OPENROUTER_PROVIDER) {
		return {
			model: resolveModel(modelRegistry, preferred.provider, preferred.model),
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
		const model = modelRegistry.find(candidate.provider, candidate.model);
		if (model) {
			return {
				model: model as Model<Api>,
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
) {
	const spec = getAgentSpec(input.agentId);
	const sessionKey = getAgentSessionKey(input.agentId, input.scopeId);
	const sessionDir = path.join(handles.agentDir, "sessions", sessionKey);
	const tools = getPiToolAllowlist(input.agentId);
	const resolvedModel = resolveAgentModel(
		handles.modelRegistry,
		spec.modelPolicy,
		input.modelProfile,
	);
	return {
		cwd: process.cwd(),
		agentDir: handles.agentDir,
		model: resolvedModel.model,
		thinkingLevel: input.thinkingLevel ?? spec.modelPolicy.thinkingLevel,
		authStorage: handles.authStorage,
		modelRegistry: handles.modelRegistry,
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

export function createPiSessionOptions(input: PiSessionOptionsInput) {
	return buildPiSessionOptions(input, createPiRuntimeHandles());
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

function extractText(
	message: Awaited<ReturnType<typeof completeSimple>>,
): string {
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
	const model = resolveModel(
		handles.modelRegistry,
		input.provider,
		input.model,
	);
	const auth = await handles.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
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
	const message = await completeSimple(model, context, {
		apiKey: auth.apiKey,
		headers: auth.headers,
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
