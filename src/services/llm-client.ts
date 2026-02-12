import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage, generateObject, generateText } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { ZodType } from "zod";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

// ---------------------------------------------------------------------------
// Per-provider semaphore — prevents overloading local Ollama and caps
// concurrent OpenRouter requests from the web server process.
// ---------------------------------------------------------------------------

type Provider = "ollama" | "openrouter";

const LIMITS: Record<Provider, number> = {
	ollama: 1,
	openrouter: 5,
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

async function getLanguageModel(provider: Provider, model: string) {
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
	const {
		provider,
		model,
		system,
		prompt,
		temperature = 0.7,
		signal,
	} = options;

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
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
		provider,
		model,
		system,
		prompt,
		schema,
		schemaName,
		temperature = 0.7,
		seed,
		signal,
	} = options;

	if (!(provider in semaphores)) {
		throw new Error(
			`Invalid LLM provider "${provider}". Must be one of: ${Object.keys(semaphores).join(", ")}`,
		);
	}
	const sem = semaphores[provider];
	await sem.acquire(signal);
	try {
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
