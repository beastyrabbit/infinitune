import {
	type AgentReasoningLevel,
	DEFAULT_AGENT_REASONING_LEVELS,
	getAgentReasoningSettingKey,
	type InfinituneAgentId,
	normalizeAgentReasoningLevel,
} from "@infinitune/shared/agent-reasoning";
import {
	DEFAULT_ANTHROPIC_TEXT_MODEL,
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import type { ZodType } from "zod";
import * as settingsService from "../services/settings-service";
import { CODEX_LLM_CONCURRENCY } from "./codex-config";
import { piCompleteObject, piCompleteText } from "./pi-runtime";

// ---------------------------------------------------------------------------
// Per-provider semaphore for Pi-managed text providers.
// ---------------------------------------------------------------------------

type Provider = LlmProvider;

const LIMITS: Record<Provider, number> = {
	"openai-codex": CODEX_LLM_CONCURRENCY,
	anthropic: 20,
};

interface Waiter {
	resolve: () => void;
	reject: (reason: unknown) => void;
}

class ProviderSemaphore {
	private active = 0;
	private readonly limit: number;
	private readonly queue: Waiter[] = [];

	constructor(limit: number) {
		if (!Number.isInteger(limit) || limit < 1) {
			throw new Error(
				`ProviderSemaphore limit must be a positive integer, got ${limit}`,
			);
		}
		this.limit = limit;
	}

	async acquire(signal?: AbortSignal): Promise<void> {
		if (this.active < this.limit) {
			this.active++;
			return;
		}

		return new Promise<void>((resolve, reject) => {
			const waiter: Waiter = { resolve, reject };
			this.queue.push(waiter);

			signal?.addEventListener(
				"abort",
				() => {
					const idx = this.queue.indexOf(waiter);
					if (idx >= 0) {
						this.queue.splice(idx, 1);
						reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
					}
					// If idx < 0, waiter was already resolved by release() - do nothing
				},
				{ once: true },
			);
		});
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next.resolve();
		} else {
			this.active--;
		}
	}
}

const semaphores: Record<Provider, ProviderSemaphore> = {
	"openai-codex": new ProviderSemaphore(LIMITS["openai-codex"]),
	anthropic: new ProviderSemaphore(LIMITS.anthropic),
};

// ---------------------------------------------------------------------------
// Provider factory (internal)
// ---------------------------------------------------------------------------

async function resolveModelForProvider(
	provider: Provider,
	model: string,
): Promise<string> {
	const explicitModel = model.trim();
	if (explicitModel) return explicitModel;

	if (provider === "anthropic") {
		return DEFAULT_ANTHROPIC_TEXT_MODEL;
	}

	return DEFAULT_OPENAI_CODEX_TEXT_MODEL;
}

async function resolveReasoningForAgent(
	agentId?: InfinituneAgentId,
): Promise<AgentReasoningLevel | undefined> {
	if (!agentId) return undefined;
	const configured = await settingsService
		.get(getAgentReasoningSettingKey(agentId))
		.catch(() => null);
	return normalizeAgentReasoningLevel(
		configured,
		DEFAULT_AGENT_REASONING_LEVELS[agentId],
	);
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export async function callLlmText(options: {
	provider: Provider;
	model: string;
	system: string;
	prompt: string;
	temperature?: number;
	reasoningAgentId?: InfinituneAgentId;
	signal?: AbortSignal;
}): Promise<string> {
	const { system, prompt, temperature = 0.7, signal } = options;
	const provider = normalizeLlmProvider(options.provider);
	const model = await resolveModelForProvider(provider, options.model);
	const reasoning = await resolveReasoningForAgent(options.reasoningAgentId);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		return await piCompleteText({
			provider,
			model,
			system,
			prompt,
			temperature,
			reasoning,
			signal,
		});
	} finally {
		sem.release();
	}
}

export async function callLlmObject<T>(options: {
	provider: Provider;
	model: string;
	system: string;
	prompt: string;
	schema: ZodType<T>;
	schemaName?: string;
	temperature?: number;
	seed?: number;
	reasoningAgentId?: InfinituneAgentId;
	signal?: AbortSignal;
}): Promise<T> {
	const {
		system,
		prompt,
		schema,
		schemaName,
		temperature = 0.7,
		seed,
		signal,
	} = options;
	const provider = normalizeLlmProvider(options.provider);
	const model = await resolveModelForProvider(provider, options.model);
	const reasoning = await resolveReasoningForAgent(options.reasoningAgentId);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		void seed;
		return await piCompleteObject({
			provider,
			model,
			system,
			prompt,
			schema,
			schemaName,
			temperature,
			reasoning,
			signal,
		});
	} finally {
		sem.release();
	}
}
