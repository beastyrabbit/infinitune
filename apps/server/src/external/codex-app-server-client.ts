import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import process from "node:process";
import z, { type ZodType } from "zod";
import { logger } from "../logger";

type RpcError = { code?: number; message?: string };

type PendingRequest = {
	method: string;
	timeout: ReturnType<typeof setTimeout>;
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
};

type PendingTurn = {
	chunks: string[];
	finalMessage: string | null;
	timeout: ReturnType<typeof setTimeout>;
	resolve: (value: string) => void;
	reject: (reason: Error) => void;
	cleanup?: () => void;
	threadId: string;
	startedAt: number;
	model: string;
	hasOutputSchema: boolean;
	promptChars: number;
};

export interface CodexAccountInfo {
	type: string;
	email?: string;
	planType?: string;
}

export interface CodexAccountReadResult {
	account: CodexAccountInfo | null;
	requiresOpenaiAuth: boolean;
}

export interface CodexModelInfo {
	id: string;
	displayName: string;
	inputModalities: string[];
	isDefault: boolean;
}

const APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = (() => {
	const raw = process.env.CODEX_TURN_TIMEOUT_MS;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	return 360_000;
})();

function isNoisyRolloutWarning(message: string): boolean {
	return (
		message.includes("codex_core::rollout::list") &&
		message.includes("state db missing rollout path for thread")
	);
}

export class CodexAppServerClient {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private stdoutBuffer = "";
	private nextRequestId = 1;
	private initialized = false;
	private startPromise: Promise<void> | null = null;
	private pendingRequests = new Map<number, PendingRequest>();
	private pendingTurns = new Map<string, PendingTurn>();
	private threadIdsByModel = new Map<string, string>();
	private threadStartPromises = new Map<string, Promise<string>>();
	private suppressedRolloutWarnings = 0;
	private lastSuppressedRolloutLogAt = 0;

	private async ensureStarted(): Promise<void> {
		if (this.initialized && this.proc && !this.proc.killed) {
			return;
		}

		if (!this.startPromise) {
			this.startPromise = this.startInternal().finally(() => {
				this.startPromise = null;
			});
		}

		await this.startPromise;
	}

	private async startInternal(): Promise<void> {
		this.spawnProcess();
		try {
			await this.requestRaw(
				"initialize",
				{
					clientInfo: {
						name: "infinitune_server",
						title: "Infinitune Server",
						version: "1.0.0",
					},
				},
				10_000,
			);
			this.send({ method: "initialized", params: {} });
			this.initialized = true;
		} catch (error) {
			if (this.proc && !this.proc.killed) {
				this.proc.kill("SIGTERM");
			}
			this.proc = null;
			this.initialized = false;
			this.stdoutBuffer = "";
			this.threadIdsByModel.clear();
			this.threadStartPromises.clear();
			throw error;
		}
	}

	private spawnProcess(): void {
		this.proc = spawn("codex", ["app-server"], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.stdoutBuffer = "";

		this.proc.stdout.on("data", (chunk: Buffer | string) => {
			this.handleStdout(chunk.toString("utf8"));
		});

		this.proc.stderr.on("data", (chunk: Buffer | string) => {
			for (const line of chunk.toString("utf8").split(/\r?\n/)) {
				const text = line.trim();
				if (!text) continue;

				if (isNoisyRolloutWarning(text)) {
					this.suppressedRolloutWarnings++;
					const now = Date.now();
					if (
						now - this.lastSuppressedRolloutLogAt >= 60_000 ||
						this.suppressedRolloutWarnings >= 100
					) {
						logger.debug(
							{ suppressedCount: this.suppressedRolloutWarnings },
							"Suppressed noisy Codex rollout warnings",
						);
						this.suppressedRolloutWarnings = 0;
						this.lastSuppressedRolloutLogAt = now;
					}
					continue;
				}

				logger.debug({ message: text }, "Codex app-server stderr");
			}
		});

		this.proc.on("error", (error) => {
			this.handleProcessExit(
				new Error(`Failed to launch codex app-server: ${error.message}`),
			);
		});

		this.proc.on("exit", (code, signal) => {
			this.handleProcessExit(
				new Error(
					`codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
				),
			);
		});
	}

	private handleProcessExit(error: Error): void {
		if (!this.proc && !this.initialized) {
			return;
		}

		this.proc = null;
		this.initialized = false;
		this.stdoutBuffer = "";
		this.threadIdsByModel.clear();
		this.threadStartPromises.clear();

		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(error);
			this.pendingRequests.delete(id);
		}

		for (const [turnId, pending] of this.pendingTurns) {
			clearTimeout(pending.timeout);
			pending.cleanup?.();
			pending.reject(error);
			this.pendingTurns.delete(turnId);
		}
	}

	private handleStdout(data: string): void {
		this.stdoutBuffer += data;

		while (true) {
			const newlineIndex = this.stdoutBuffer.indexOf("\n");
			if (newlineIndex < 0) {
				break;
			}

			const rawLine = this.stdoutBuffer.slice(0, newlineIndex).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (!rawLine) {
				continue;
			}

			let message: unknown;
			try {
				message = JSON.parse(rawLine);
			} catch (error) {
				logger.warn(
					{ line: rawLine, err: error },
					"Failed to parse Codex app-server JSONL line",
				);
				continue;
			}

			this.handleMessage(message);
		}
	}

	private handleMessage(message: unknown): void {
		if (!message || typeof message !== "object") {
			return;
		}

		const msg = message as {
			id?: unknown;
			result?: unknown;
			error?: RpcError;
			method?: unknown;
			params?: unknown;
		};

		if (typeof msg.id === "number") {
			const pending = this.pendingRequests.get(msg.id);
			if (!pending) {
				return;
			}
			clearTimeout(pending.timeout);
			this.pendingRequests.delete(msg.id);

			if (msg.error) {
				pending.reject(
					new Error(
						msg.error.message ??
							`Codex app-server request failed for ${pending.method}`,
					),
				);
				return;
			}

			pending.resolve(msg.result);
			return;
		}

		if (typeof msg.method !== "string") {
			return;
		}

		const method = msg.method;
		const params = msg.params;
		if (method === "item/agentMessage/delta") {
			this.handleAgentMessageDelta(params);
			return;
		}

		if (method === "item/completed") {
			this.handleItemCompleted(params);
			return;
		}

		if (method === "turn/completed") {
			this.handleTurnCompleted(params);
		}
	}

	private handleAgentMessageDelta(params: unknown): void {
		if (!params || typeof params !== "object") {
			return;
		}
		const p = params as { turnId?: unknown; delta?: unknown };
		if (typeof p.turnId !== "string") {
			return;
		}
		const pendingTurn = this.pendingTurns.get(p.turnId);
		if (!pendingTurn) {
			return;
		}
		if (typeof p.delta === "string") {
			pendingTurn.chunks.push(p.delta);
		}
	}

	private handleItemCompleted(params: unknown): void {
		if (!params || typeof params !== "object") {
			return;
		}
		const p = params as { turnId?: unknown; item?: unknown };
		if (typeof p.turnId !== "string") {
			return;
		}
		const pendingTurn = this.pendingTurns.get(p.turnId);
		if (!pendingTurn) {
			return;
		}
		if (!p.item || typeof p.item !== "object") {
			return;
		}
		const item = p.item as { type?: unknown; text?: unknown };
		if (item.type === "agentMessage" && typeof item.text === "string") {
			pendingTurn.finalMessage = item.text;
		}
	}

	private handleTurnCompleted(params: unknown): void {
		if (!params || typeof params !== "object") {
			return;
		}
		const p = params as {
			turn?: { id?: unknown; status?: unknown; error?: unknown };
		};
		const turnId = p.turn?.id;
		if (typeof turnId !== "string") {
			return;
		}
		const pendingTurn = this.pendingTurns.get(turnId);
		if (!pendingTurn) {
			return;
		}

		clearTimeout(pendingTurn.timeout);
		pendingTurn.cleanup?.();
		this.pendingTurns.delete(turnId);

		const status = p.turn?.status;
		if (status !== "completed") {
			const failureMessage = this.extractTurnFailureMessage(p.turn?.error);
			logger.warn(
				{
					threadId: pendingTurn.threadId,
					turnId,
					model: pendingTurn.model,
					hasOutputSchema: pendingTurn.hasOutputSchema,
					promptChars: pendingTurn.promptChars,
					elapsedMs: Date.now() - pendingTurn.startedAt,
					status,
					failureMessage,
				},
				"Codex turn failed",
			);
			pendingTurn.reject(new Error(failureMessage));
			return;
		}

		const text = pendingTurn.finalMessage ?? pendingTurn.chunks.join("");
		logger.debug(
			{
				threadId: pendingTurn.threadId,
				turnId,
				model: pendingTurn.model,
				hasOutputSchema: pendingTurn.hasOutputSchema,
				promptChars: pendingTurn.promptChars,
				elapsedMs: Date.now() - pendingTurn.startedAt,
				responseChars: text.length,
			},
			"Codex turn completed",
		);
		pendingTurn.resolve(text.trim());
	}

	private extractTurnFailureMessage(errorValue: unknown): string {
		if (!errorValue || typeof errorValue !== "object") {
			return "Codex turn failed";
		}
		const err = errorValue as { message?: unknown };
		if (typeof err.message === "string" && err.message.trim()) {
			return err.message;
		}
		return "Codex turn failed";
	}

	private send(message: {
		method: string;
		id?: number;
		params?: unknown;
	}): void {
		if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
			throw new Error("codex app-server is not running");
		}
		this.proc.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private async requestRaw(
		method: string,
		params?: unknown,
		timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		if (!this.proc || this.proc.killed || !this.proc.stdin.writable) {
			throw new Error("codex app-server is not running");
		}

		const id = this.nextRequestId++;
		return await new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Codex request timed out: ${method}`));
			}, timeoutMs);

			this.pendingRequests.set(id, {
				method,
				timeout,
				resolve,
				reject,
			});

			try {
				this.send({ method, id, params });
			} catch (error) {
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
				reject(
					error instanceof Error
						? error
						: new Error(`Failed to send request: ${method}`),
				);
			}
		});
	}

	private async request(
		method: string,
		params?: unknown,
		timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		await this.ensureStarted();
		return await this.requestRaw(method, params, timeoutMs);
	}

	private async readThreadModel(model: string): Promise<string> {
		const existing = this.threadIdsByModel.get(model);
		if (existing) {
			return existing;
		}

		const activeStart = this.threadStartPromises.get(model);
		if (activeStart) {
			return await activeStart;
		}

		const startPromise = (async () => {
			const raw = await this.request(
				"thread/start",
				{
					model,
					cwd: process.cwd(),
					approvalPolicy: "never",
					sandbox: "read-only",
				},
				APP_SERVER_REQUEST_TIMEOUT_MS,
			);
			const result = raw as { thread?: { id?: string } };
			const threadId = result.thread?.id;
			if (!threadId) {
				throw new Error("Codex thread/start returned no thread id");
			}
			this.threadIdsByModel.set(model, threadId);
			return threadId;
		})();

		this.threadStartPromises.set(model, startPromise);
		try {
			return await startPromise;
		} finally {
			if (this.threadStartPromises.get(model) === startPromise) {
				this.threadStartPromises.delete(model);
			}
		}
	}

	private async runTurn(options: {
		model: string;
		text: string;
		outputSchema?: Record<string, unknown>;
		signal?: AbortSignal;
	}): Promise<string> {
		const threadId = await this.readThreadModel(options.model);
		const turnRaw = await this.request(
			"turn/start",
			{
				threadId,
				model: options.model,
				input: [{ type: "text", text: options.text }],
				...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
			},
			APP_SERVER_REQUEST_TIMEOUT_MS,
		);

		const turnResult = turnRaw as { turn?: { id?: string } };
		const turnId = turnResult.turn?.id;
		if (!turnId) {
			throw new Error("Codex turn/start returned no turn id");
		}
		const startedAt = Date.now();
		logger.debug(
			{
				threadId,
				turnId,
				model: options.model,
				hasOutputSchema: !!options.outputSchema,
				promptChars: options.text.length,
				timeoutMs: TURN_TIMEOUT_MS,
			},
			"Codex turn started",
		);

		return await new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				const elapsedMs = Date.now() - startedAt;
				const pendingTurnsCount = this.pendingTurns.size;
				this.pendingTurns.delete(turnId);
				void this.request("turn/interrupt", { threadId, turnId }).catch(
					() => {},
				);
				logger.warn(
					{
						threadId,
						turnId,
						model: options.model,
						hasOutputSchema: !!options.outputSchema,
						promptChars: options.text.length,
						elapsedMs,
						timeoutMs: TURN_TIMEOUT_MS,
						pendingTurnsCount,
					},
					"Codex turn timed out, interrupt sent",
				);
				reject(new Error("Codex turn timed out"));
			}, TURN_TIMEOUT_MS);

			const pendingTurn: PendingTurn = {
				chunks: [],
				finalMessage: null,
				threadId,
				timeout,
				resolve,
				reject,
				startedAt,
				model: options.model,
				hasOutputSchema: !!options.outputSchema,
				promptChars: options.text.length,
			};

			if (options.signal) {
				if (options.signal.aborted) {
					clearTimeout(timeout);
					void this.request("turn/interrupt", { threadId, turnId }).catch(
						() => {},
					);
					logger.warn(
						{
							threadId,
							turnId,
							model: options.model,
							hasOutputSchema: !!options.outputSchema,
							promptChars: options.text.length,
						},
						"Codex turn aborted before completion",
					);
					reject(
						options.signal.reason instanceof Error
							? options.signal.reason
							: new Error("Codex turn aborted"),
					);
					return;
				}

				const onAbort = () => {
					clearTimeout(timeout);
					this.pendingTurns.delete(turnId);
					void this.request("turn/interrupt", { threadId, turnId }).catch(
						() => {},
					);
					logger.warn(
						{
							threadId,
							turnId,
							model: options.model,
							hasOutputSchema: !!options.outputSchema,
							promptChars: options.text.length,
							elapsedMs: Date.now() - startedAt,
						},
						"Codex turn aborted by signal",
					);
					reject(
						options.signal?.reason instanceof Error
							? options.signal.reason
							: new Error("Codex turn aborted"),
					);
				};
				options.signal.addEventListener("abort", onAbort, { once: true });
				pendingTurn.cleanup = () => {
					options.signal?.removeEventListener("abort", onAbort);
				};
			}

			this.pendingTurns.set(turnId, pendingTurn);
		});
	}

	private buildPrompt(
		system: string,
		prompt: string,
		jsonOnly: boolean,
	): string {
		const systemText = system.trim();
		const promptText = prompt.trim();
		const jsonDirective = jsonOnly
			? "\n\nReturn only valid JSON. Do not include markdown fences or commentary."
			: "";
		if (!systemText) {
			return `${promptText}${jsonDirective}`;
		}
		return `System instructions:\n${systemText}\n\nUser request:\n${promptText}${jsonDirective}`;
	}

	private parseJsonFromText(text: string): unknown {
		try {
			return JSON.parse(text);
		} catch {
			// Continue to fallbacks.
		}

		const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
		if (fencedMatch?.[1]) {
			return JSON.parse(fencedMatch[1]);
		}

		const start = text.indexOf("{");
		const end = text.lastIndexOf("}");
		if (start >= 0 && end > start) {
			return JSON.parse(text.slice(start, end + 1));
		}

		throw new Error("Codex did not return valid JSON");
	}

	private normalizeCodexOutputSchema(
		schema: Record<string, unknown>,
	): Record<string, unknown> {
		const normalizeNode = (node: unknown): unknown => {
			if (!node || typeof node !== "object" || Array.isArray(node)) {
				return node;
			}

			const current: Record<string, unknown> = {
				...(node as Record<string, unknown>),
			};

			if (
				current.properties &&
				typeof current.properties === "object" &&
				!Array.isArray(current.properties)
			) {
				const normalizedProperties = Object.fromEntries(
					Object.entries(current.properties as Record<string, unknown>).map(
						([key, value]) => [key, normalizeNode(value)],
					),
				);

				current.properties = normalizedProperties;
				const propertyKeys = Object.keys(normalizedProperties);
				if (propertyKeys.length > 0) {
					if (!Array.isArray(current.required)) {
						current.required = propertyKeys;
					}
					if (current.additionalProperties === undefined) {
						current.additionalProperties = false;
					}
				}
			}

			if (current.items !== undefined) {
				current.items = normalizeNode(current.items);
			}
			if (Array.isArray(current.anyOf)) {
				current.anyOf = current.anyOf.map(normalizeNode);
			}
			if (Array.isArray(current.oneOf)) {
				current.oneOf = current.oneOf.map(normalizeNode);
			}
			if (Array.isArray(current.allOf)) {
				current.allOf = current.allOf.map(normalizeNode);
			}
			if (
				current.$defs &&
				typeof current.$defs === "object" &&
				!Array.isArray(current.$defs)
			) {
				current.$defs = Object.fromEntries(
					Object.entries(current.$defs as Record<string, unknown>).map(
						([key, value]) => [key, normalizeNode(value)],
					),
				);
			}

			return current;
		};

		return normalizeNode(schema) as Record<string, unknown>;
	}

	private async ensureChatgptAuth(): Promise<void> {
		const account = await this.readAccount();
		if (!account.account || account.account.type !== "chatgpt") {
			throw new Error(
				"OpenAI Codex provider requires ChatGPT login. Start Codex device auth in Settings.",
			);
		}
	}

	async readAccount(): Promise<CodexAccountReadResult> {
		const raw = await this.request("account/read", { refreshToken: false });
		const parsed = raw as {
			account?: { type?: unknown; email?: unknown; planType?: unknown } | null;
			requiresOpenaiAuth?: unknown;
		};

		const accountValue = parsed.account;
		const account =
			accountValue && typeof accountValue === "object"
				? {
						type:
							typeof accountValue.type === "string"
								? accountValue.type
								: "unknown",
						email:
							typeof accountValue.email === "string"
								? accountValue.email
								: undefined,
						planType:
							typeof accountValue.planType === "string"
								? accountValue.planType
								: undefined,
					}
				: null;

		return {
			account,
			requiresOpenaiAuth: parsed.requiresOpenaiAuth !== false,
		};
	}

	async listModels(): Promise<CodexModelInfo[]> {
		await this.ensureChatgptAuth();

		const raw = await this.request("model/list", { limit: 200 });
		const data = raw as {
			data?: Array<{
				id?: unknown;
				displayName?: unknown;
				inputModalities?: unknown;
				isDefault?: unknown;
			}>;
		};

		const models = Array.isArray(data.data) ? data.data : [];
		return models
			.filter((m) => typeof m.id === "string")
			.map((m) => ({
				id: m.id as string,
				displayName:
					typeof m.displayName === "string" ? m.displayName : (m.id as string),
				inputModalities: Array.isArray(m.inputModalities)
					? m.inputModalities.filter(
							(mod): mod is string => typeof mod === "string",
						)
					: ["text", "image"],
				isDefault: m.isDefault === true,
			}));
	}

	async generateText(options: {
		model: string;
		system: string;
		prompt: string;
		signal?: AbortSignal;
	}): Promise<string> {
		await this.ensureChatgptAuth();

		const text = await this.runTurn({
			model: options.model,
			text: this.buildPrompt(options.system, options.prompt, false),
			signal: options.signal,
		});
		if (!text) {
			throw new Error("Codex returned an empty response");
		}
		return text;
	}

	async generateJson(options: {
		model: string;
		system: string;
		prompt: string;
		outputSchema: Record<string, unknown>;
		signal?: AbortSignal;
	}): Promise<unknown> {
		await this.ensureChatgptAuth();
		const outputSchema = this.normalizeCodexOutputSchema(options.outputSchema);

		const rawText = await this.runTurn({
			model: options.model,
			text: this.buildPrompt(options.system, options.prompt, true),
			outputSchema,
			signal: options.signal,
		});
		return this.parseJsonFromText(rawText);
	}

	async generateObject<T>(options: {
		model: string;
		system: string;
		prompt: string;
		schema: ZodType<T>;
		signal?: AbortSignal;
	}): Promise<T> {
		await this.ensureChatgptAuth();

		const outputSchema = this.normalizeCodexOutputSchema(
			z.toJSONSchema(options.schema) as Record<string, unknown>,
		);
		const rawText = await this.runTurn({
			model: options.model,
			text: this.buildPrompt(options.system, options.prompt, true),
			outputSchema,
			signal: options.signal,
		});
		const parsedJson = this.parseJsonFromText(rawText);
		return options.schema.parse(parsedJson);
	}

	async dispose(): Promise<void> {
		if (this.proc && !this.proc.killed) {
			this.proc.kill("SIGTERM");
		}
	}
}

export const codexAppServerClient = new CodexAppServerClient();
