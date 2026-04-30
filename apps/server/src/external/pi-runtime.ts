import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type AgentReasoningLevel,
	getAgentReasoningSettingKey,
	normalizeAgentReasoningLevel,
} from "@infinitune/shared/agent-reasoning";
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
	getAgentSessionKey,
	getAgentSpec,
	getPiToolAllowlist,
} from "../agents/agent-registry";
import { createAgentTools } from "../agents/tools";
import * as settingsService from "../services/settings-service";

const DEFAULT_PI_AGENT_DIR = path.join(os.homedir(), ".infinitune", "pi");
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
	const modelRegistry = ModelRegistry.create(authStorage, modelsJsonPath);
	return { agentDir, authPath, modelsJsonPath, authStorage, modelRegistry };
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

function resolveModel(
	modelRegistry: ModelRegistry,
	provider: string,
	modelId: string,
): Model<Api> {
	const model = modelRegistry.find(provider, modelId);
	if (!model) throw new Error(`Pi model not found: ${provider}/${modelId}`);
	return model as Model<Api>;
}

export function createPiSessionOptions(input: {
	agentId: AgentId;
	scopeId?: string | null;
	customTools?: ToolDefinition[];
	thinkingLevel?: AgentReasoningLevel;
}) {
	const handles = createPiRuntimeHandles();
	const spec = getAgentSpec(input.agentId);
	const sessionKey = getAgentSessionKey(input.agentId, input.scopeId);
	const sessionDir = path.join(handles.agentDir, "sessions", sessionKey);
	const tools = getPiToolAllowlist(input.agentId);
	const model = resolveModel(
		handles.modelRegistry,
		spec.modelPolicy.primary.provider,
		spec.modelPolicy.primary.model,
	);
	return {
		cwd: process.cwd(),
		agentDir: handles.agentDir,
		model,
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
			defaultProvider: spec.modelPolicy.primary.provider,
			defaultModel: spec.modelPolicy.primary.model,
		}),
		noTools: "builtin" as const,
		tools,
		customTools: input.customTools ?? createAgentTools(input.agentId),
	};
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
}) {
	const thinkingLevel = await getInfinituneAgentReasoningLevel(input.agentId);
	return await createAgentSession(
		createPiSessionOptions({ ...input, thinkingLevel }),
	);
}

export async function promptInfinituneAgent(input: {
	agentId: AgentId;
	scopeId?: string | null;
	prompt: string;
	customTools?: ToolDefinition[];
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
		await session.prompt(input.prompt);
		return text.trim();
	} finally {
		session.dispose();
	}
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
	provider: "openai-codex" | "anthropic";
	model: string;
	system: string;
	prompt: string;
	temperature?: number;
	reasoning?: AgentReasoningLevel;
	signal?: AbortSignal;
}): Promise<string> {
	const handles = createPiRuntimeHandles();
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
		...(input.provider === "openai-codex"
			? {}
			: { temperature: input.temperature }),
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
	provider: "openai-codex" | "anthropic";
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
