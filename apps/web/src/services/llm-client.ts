import {
	DEFAULT_ANTHROPIC_TEXT_MODEL,
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import z, { type ZodType } from "zod";
import { API_URL } from "@/lib/endpoints";

// ---------------------------------------------------------------------------
// Per-provider semaphore for app-server text generation requests.
// ---------------------------------------------------------------------------

type Provider = LlmProvider;

const LIMITS: Record<Provider, number> = {
	"openai-codex": 2,
	anthropic: 2,
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
	signal?: AbortSignal,
): Promise<string> {
	const explicitModel = model.trim();
	if (explicitModel) return explicitModel;

	if (provider === "anthropic") {
		return DEFAULT_ANTHROPIC_TEXT_MODEL;
	}

	const res = await fetch(`${API_URL}/api/autoplayer/codex-models`, {
		signal,
	});
	const data = (await res.json().catch(() => null)) as {
		models?: Array<{ name?: string; is_default?: boolean }>;
		error?: string;
	} | null;

	if (!res.ok) {
		throw new Error(
			data?.error ||
				`Failed to resolve OpenAI Codex model from /codex-models (${res.status})`,
		);
	}

	const models = data?.models ?? [];
	if (models.length === 0) {
		throw new Error(
			"No OpenAI Codex models are available. Complete Codex authentication in Settings.",
		);
	}

	const preferred =
		models.find((m) => m.is_default && m.name) ??
		models.find((m) => m.name === "gpt-5.2") ??
		models.find((m) => m.name && m.name.trim().length > 0);

	if (!preferred?.name) {
		return DEFAULT_OPENAI_CODEX_TEXT_MODEL;
	}

	return preferred.name;
}

async function callCodexTextEndpoint(options: {
	model: string;
	system: string;
	prompt: string;
	signal?: AbortSignal;
}): Promise<string> {
	const res = await fetch(`${API_URL}/api/autoplayer/codex/text`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: options.model,
			system: options.system,
			prompt: options.prompt,
		}),
		signal: options.signal,
	});

	const data = (await res.json().catch(() => null)) as {
		text?: string;
		error?: string;
	} | null;

	if (!res.ok) {
		throw new Error(
			data?.error || `Codex text generation failed (${res.status})`,
		);
	}
	if (!data?.text) {
		throw new Error("Codex returned an empty response");
	}
	return data.text;
}

async function callCodexObjectEndpoint<T>(options: {
	model: string;
	system: string;
	prompt: string;
	schema: ZodType<T>;
	signal?: AbortSignal;
}): Promise<T> {
	const schemaJson = z.toJSONSchema(options.schema) as Record<string, unknown>;
	const res = await fetch(`${API_URL}/api/autoplayer/codex/object`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: options.model,
			system: options.system,
			prompt: options.prompt,
			schema: schemaJson,
		}),
		signal: options.signal,
	});

	const data = (await res.json().catch(() => null)) as {
		object?: unknown;
		error?: string;
	} | null;

	if (!res.ok) {
		throw new Error(
			data?.error || `Codex object generation failed (${res.status})`,
		);
	}
	return options.schema.parse(data?.object);
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
	signal?: AbortSignal;
}): Promise<string> {
	const { system, prompt, temperature = 0.7, signal } = options;
	const provider = normalizeLlmProvider(options.provider);
	const model = await resolveModelForProvider(provider, options.model, signal);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		if (provider === "openai-codex") {
			return await callCodexTextEndpoint({
				model,
				system,
				prompt,
				signal,
			});
		}

		void temperature;
		throw new Error(
			"Anthropic text generation is handled by the API server Pi runtime.",
		);
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
	const model = await resolveModelForProvider(provider, options.model, signal);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		if (provider === "openai-codex") {
			return await callCodexObjectEndpoint({
				model,
				system,
				prompt,
				schema,
				signal,
			});
		}

		void schemaName;
		void temperature;
		void seed;
		throw new Error(
			"Anthropic object generation is handled by the API server Pi runtime.",
		);
	} finally {
		sem.release();
	}
}
