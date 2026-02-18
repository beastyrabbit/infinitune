import {
	DEFAULT_OLLAMA_TEXT_MODEL,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, generateObject, generateText } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { ZodType } from "zod";
import { codexAppServerClient } from "./codex-app-server-client";
import { getServiceUrls, getSetting } from "./service-urls";

// ---------------------------------------------------------------------------
// Per-provider semaphore — prevents overloading local Ollama and caps
// concurrent OpenRouter requests from the web server process.
// ---------------------------------------------------------------------------

type Provider = LlmProvider;

export const CODEX_LLM_CONCURRENCY = (() => {
	const raw = process.env.CODEX_LLM_CONCURRENCY;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	// Default to effectively unthrottled Codex calls from this process.
	return 100;
})();

const LIMITS: Record<Provider, number> = {
	ollama: 1,
	openrouter: 5,
	"openai-codex": CODEX_LLM_CONCURRENCY,
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

	const codexModels = await codexAppServerClient.listModels();
	if (codexModels.length === 0) {
		throw new Error(
			"No OpenAI Codex models are available. Complete Codex authentication in Settings.",
		);
	}

	const preferred =
		codexModels.find((m) => m.isDefault) ??
		codexModels.find((m) => m.id === "gpt-5.2") ??
		codexModels[0];

	if (!preferred?.id) {
		throw new Error(
			"No OpenAI Codex models are available. Complete Codex authentication in Settings.",
		);
	}

	return preferred.id;
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
	const model = await resolveModelForProvider(provider, options.model);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		if (provider === "openai-codex") {
			return await codexAppServerClient.generateText({
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
	const model = await resolveModelForProvider(provider, options.model);

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
		if (provider === "openai-codex") {
			return await codexAppServerClient.generateObject({
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
