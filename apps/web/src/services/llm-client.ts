import {
	DEFAULT_OLLAMA_TEXT_MODEL,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, generateObject, generateText } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import z, { type ZodType } from "zod";
import { API_URL } from "@/lib/endpoints";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

// ---------------------------------------------------------------------------
// Per-provider semaphore — prevents overloading local Ollama and caps
// concurrent OpenRouter requests from the web server process.
// ---------------------------------------------------------------------------

type Provider = LlmProvider;

const LIMITS: Record<Provider, number> = {
	ollama: 1,
	openrouter: 5,
	"openai-codex": 2,
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
	ollama: new ProviderSemaphore(LIMITS.ollama),
	openrouter: new ProviderSemaphore(LIMITS.openrouter),
	"openai-codex": new ProviderSemaphore(LIMITS["openai-codex"]),
};

// ---------------------------------------------------------------------------
// Provider factory (internal)
// ---------------------------------------------------------------------------

async function getOpenRouterApiKey(): Promise<string> {
	return (
		(await getSetting("openrouterApiKey")) ||
		process.env.OPENROUTER_API_KEY ||
		""
	);
}

async function getLanguageModel(
	provider: Exclude<Provider, "openai-codex">,
	model: string,
) {
	if (provider === "openrouter") {
		const or = createOpenRouter({ apiKey: await getOpenRouterApiKey() });
		return or(model, { plugins: [{ id: "response-healing" }] });
	}
	const urls = await getServiceUrls();
	const ollama = createOllama({ baseURL: `${urls.ollamaUrl}/api` });
	return ollama(model);
}

async function getImageModel(model: string) {
	const or = createOpenRouter({ apiKey: await getOpenRouterApiKey() });
	return or.imageModel(model);
}

async function resolveModelForProvider(
	provider: Provider,
	model: string,
	signal?: AbortSignal,
): Promise<string> {
	const explicitModel = model.trim();
	if (explicitModel) return explicitModel;

	if (provider === "ollama") {
		return DEFAULT_OLLAMA_TEXT_MODEL;
	}

	if (provider === "openrouter") {
		throw new Error(
			'No OpenRouter model configured. Select a text model (for example "openai/gpt-4.1") in Settings.',
		);
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
		models.find((m) => m.name);

	if (!preferred?.name) {
		throw new Error(
			"No OpenAI Codex models are available. Complete Codex authentication in Settings.",
		);
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

		const languageModel = await getLanguageModel(provider, model);
		const providerOptions =
			provider === "ollama" ? { ollama: { think: false } } : undefined;

		const { text } = await generateText({
			model: languageModel,
			system,
			prompt,
			temperature,
			providerOptions,
			abortSignal: signal,
		});
		return text;
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

		const languageModel = await getLanguageModel(provider, model);
		const providerOptions =
			provider === "ollama"
				? {
						ollama: {
							think: false,
							...(seed !== undefined && { options: { seed } }),
						},
					}
				: undefined;

		const { object } = await generateObject({
			model: languageModel,
			output: "object",
			system,
			prompt,
			schema,
			schemaName,
			temperature,
			providerOptions,
			abortSignal: signal,
		});
		return object;
	} finally {
		sem.release();
	}
}

export async function callImageGen(options: {
	model: string;
	prompt: string;
	signal?: AbortSignal;
}): Promise<{ base64: string }> {
	const { model, prompt, signal } = options;

	const sem = semaphores.openrouter;
	await sem.acquire(signal);
	try {
		const imageModel = await getImageModel(model);
		const { image } = await generateImage({
			model: imageModel,
			prompt,
			abortSignal: signal,
		});
		return { base64: image.base64 };
	} finally {
		sem.release();
	}
}
