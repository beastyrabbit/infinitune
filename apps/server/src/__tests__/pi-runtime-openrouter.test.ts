import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	getAll: vi.fn(),
	migrateSensitiveSetting: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, createAgentSession: mocks.createAgentSession };
});

vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue(null),
	getAll: mocks.getAll,
	migrateSensitiveSetting: mocks.migrateSensitiveSetting,
}));

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { FileCredentialStore } from "../external/pi-credential-store";
import {
	createInfinituneAgentSession,
	createPiCredentialStore,
	migrateLegacyOpenRouterCredential,
	piCompleteText,
} from "../external/pi-runtime";

const completeSimple = vi.spyOn(ModelRuntime.prototype, "completeSimple");

function assistantText(text: string): AssistantMessage {
	return {
		content: [{ type: "text", text }],
		stopReason: "stop",
	} as unknown as AssistantMessage;
}

describe("OpenRouter Pi runtime", () => {
	let agentDir: string;
	let previousAgentDir: string | undefined;
	let previousCodexHome: string | undefined;
	let previousEnvironmentKey: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(path.join(tmpdir(), "infinitune-pi-openrouter-"));
		previousAgentDir = process.env.INFINITUNE_PI_AGENT_DIR;
		previousCodexHome = process.env.CODEX_HOME;
		previousEnvironmentKey = process.env.OPENROUTER_API_KEY;
		process.env.INFINITUNE_PI_AGENT_DIR = agentDir;
		process.env.CODEX_HOME = path.join(agentDir, "codex");
		delete process.env.OPENROUTER_API_KEY;
		completeSimple.mockReset();
		mocks.createAgentSession.mockReset();
		mocks.getAll.mockReset();
		mocks.getAll.mockResolvedValue({});
		mocks.migrateSensitiveSetting.mockReset();
		mocks.migrateSensitiveSetting.mockResolvedValue(false);
	});

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env.INFINITUNE_PI_AGENT_DIR;
		} else {
			process.env.INFINITUNE_PI_AGENT_DIR = previousAgentDir;
		}
		if (previousEnvironmentKey === undefined) {
			delete process.env.OPENROUTER_API_KEY;
		} else {
			process.env.OPENROUTER_API_KEY = previousEnvironmentKey;
		}
		if (previousCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = previousCodexHome;
		}
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("resolves the package-local openrouter/auto model in the headless path", async () => {
		mocks.migrateSensitiveSetting.mockImplementationOnce(
			async (_key, writeReplacement) => {
				await writeReplacement("legacy-test-key");
				return true;
			},
		);
		completeSimple.mockResolvedValue(assistantText("generated lyrics"));

		await expect(
			piCompleteText({
				provider: "openrouter",
				model: "auto",
				system: "system",
				prompt: "prompt",
				temperature: 0.82,
			}),
		).resolves.toBe("generated lyrics");

		expect(mocks.migrateSensitiveSetting).toHaveBeenCalledWith(
			"openrouterApiKey",
			expect.any(Function),
		);
		expect(completeSimple).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "auto",
				provider: "openrouter",
			}),
			expect.any(Object),
			expect.objectContaining({ reasoning: "medium" }),
		);
		const { credentials } = await createPiCredentialStore();
		expect(await credentials.read("openrouter")).toEqual({
			type: "api_key",
			key: "legacy-test-key",
		});
		expect(completeSimple.mock.calls[0]?.[2]).not.toHaveProperty("temperature");
	});

	it("sends temperature to non-reasoning OpenRouter models", async () => {
		process.env.OPENROUTER_API_KEY = "openrouter-test-key";
		completeSimple.mockResolvedValue(assistantText("openrouter text"));

		await expect(
			piCompleteText({
				provider: "openrouter",
				model: "deepseek/deepseek-chat",
				system: "system",
				prompt: "prompt",
				temperature: 0.82,
			}),
		).resolves.toBe("openrouter text");

		expect(completeSimple.mock.calls[0]?.[2]).toHaveProperty(
			"temperature",
			0.82,
		);
	});

	it("does not send temperature to Codex reasoning models", async () => {
		const { credentials } = await createPiCredentialStore();
		// Far-future expiry: an expired token would trigger a real OAuth refresh.
		await credentials.modify("openai-codex", async () => ({
			type: "oauth",
			access: "codex-test-token",
			refresh: "codex-refresh-token",
			expires: Date.now() + 60 * 60 * 1000,
		}));
		completeSimple.mockResolvedValue(assistantText("codex text"));

		await expect(
			piCompleteText({
				provider: "openai-codex",
				model: "gpt-5.2",
				system: "system",
				prompt: "prompt",
				temperature: 0.82,
			}),
		).resolves.toBe("codex text");

		const completionOptions = completeSimple.mock.calls[0]?.[2];
		expect(completionOptions).not.toHaveProperty("temperature");
		expect(completionOptions).toHaveProperty("reasoning", "medium");
	});

	it("keeps a newly stored key when a legacy migration uses a stale handle", async () => {
		const stale = (await createPiCredentialStore()).credentials;
		const current = (await createPiCredentialStore()).credentials;
		await current.modify("openrouter", async () => ({
			type: "api_key",
			key: "current-openrouter-key",
		}));
		mocks.migrateSensitiveSetting.mockImplementationOnce(
			async (_key, writeReplacement) => {
				await writeReplacement("legacy-openrouter-key");
				return true;
			},
		);

		await migrateLegacyOpenRouterCredential(stale);

		expect(await stale.read("openrouter")).toEqual({
			type: "api_key",
			key: "current-openrouter-key",
		});
	});

	it("keeps stored OpenRouter auth when seeding Codex auth", async () => {
		const initial = (await createPiCredentialStore()).credentials;
		await initial.modify("openrouter", async () => ({
			type: "api_key",
			key: "stored-openrouter-key",
		}));

		mkdirSync(process.env.CODEX_HOME as string, { recursive: true });
		const payload = Buffer.from(
			JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
		).toString("base64url");
		writeFileSync(
			path.join(process.env.CODEX_HOME as string, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: `header.${payload}.signature`,
					refresh_token: "codex-refresh-token",
					account_id: "account-1",
				},
			}),
			"utf8",
		);

		const seeded = (await createPiCredentialStore()).credentials;

		expect(await seeded.read("openrouter")).toEqual({
			type: "api_key",
			key: "stored-openrouter-key",
		});
		expect(await seeded.read("openai-codex")).toMatchObject({
			type: "oauth",
			refresh: "codex-refresh-token",
			accountId: "account-1",
		});
	});

	it("rejects an unknown OpenRouter model before making a request", async () => {
		await expect(
			piCompleteText({
				provider: "openrouter",
				model: "unknown/model-id",
				system: "system",
				prompt: "prompt",
			}),
		).rejects.toThrow("Pi model not found: openrouter/unknown/model-id");
		expect(completeSimple).not.toHaveBeenCalled();
	});

	it("prepares OpenRouter auth before creating a Pi agent session", async () => {
		mocks.getAll.mockResolvedValue({
			textProvider: "openrouter",
			textModel: "auto",
		});
		mocks.migrateSensitiveSetting.mockImplementationOnce(
			async (_key, writeReplacement) => {
				await writeReplacement("legacy-agent-key");
				return true;
			},
		);
		mocks.createAgentSession.mockResolvedValue({ session: "test-session" });

		await expect(
			createInfinituneAgentSession({ agentId: "playlist-director" }),
		).resolves.toEqual({ session: "test-session" });
		expect(mocks.createAgentSession).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					id: "auto",
					provider: "openrouter",
				}),
				modelRuntime: expect.any(ModelRuntime),
			}),
		);
		const options = mocks.createAgentSession.mock.calls[0]?.[0];
		expect(options).not.toHaveProperty("authStorage");
		expect(options).not.toHaveProperty("modelRegistry");
		await expect(
			options.modelRuntime.getAuth("openrouter"),
		).resolves.toMatchObject({ auth: { apiKey: "legacy-agent-key" } });
	});

	it("keeps Codex models that Pi's bundled catalog no longer lists", async () => {
		mocks.getAll.mockResolvedValue({
			textProvider: "openai-codex",
			textModel: "gpt-5.4",
		});
		mocks.createAgentSession.mockResolvedValue({ session: "codex-session" });

		await createInfinituneAgentSession({ agentId: "playlist-director" });

		expect(mocks.createAgentSession).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					id: "gpt-5.4",
					provider: "openai-codex",
					api: "openai-codex-responses",
				}),
			}),
		);
	});

	it("derives unknown Codex models from the bundled catalog, not models.json", async () => {
		writeFileSync(
			path.join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					"openai-codex": {
						baseUrl: "http://127.0.0.1:9/v1",
						api: "openai-completions",
						apiKey: "unused",
						models: [{ id: "custom-local" }],
					},
				},
			}),
		);
		mocks.createAgentSession.mockResolvedValue({ session: "codex-session" });

		await createInfinituneAgentSession({
			agentId: "playlist-director",
			modelProfile: { provider: "openai-codex", model: "gpt-9-future" },
		});

		expect(mocks.createAgentSession).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					id: "gpt-9-future",
					api: "openai-codex-responses",
				}),
			}),
		);
	});

	it("prefers an explicit playlist model profile over global settings", async () => {
		mocks.getAll.mockResolvedValue({
			textProvider: "openai-codex",
			textModel: "gpt-5.2",
		});
		mocks.createAgentSession.mockResolvedValue({ session: "playlist-session" });

		await expect(
			createInfinituneAgentSession({
				agentId: "playlist-director",
				modelProfile: { provider: "openrouter", model: "auto" },
			}),
		).resolves.toEqual({ session: "playlist-session" });
		expect(mocks.createAgentSession).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					id: "auto",
					provider: "openrouter",
				}),
			}),
		);
	});

	it("does not fall back to Codex for an unknown OpenRouter agent model", async () => {
		mocks.getAll.mockResolvedValue({
			textProvider: "openrouter",
			textModel: "unknown/agent-model",
		});

		await expect(
			createInfinituneAgentSession({ agentId: "playlist-director" }),
		).rejects.toThrow("Pi model not found: openrouter/unknown/agent-model");
		expect(mocks.createAgentSession).not.toHaveBeenCalled();
	});
});

describe("FileCredentialStore", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "infinitune-pi-credentials-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns command- and variable-shaped keys literally", async () => {
		const store = new FileCredentialStore(path.join(dir, "auth.json"));
		await store.modify("openrouter", async () => ({
			type: "api_key",
			key: "$HOME",
		}));
		await store.modify("other", async () => ({
			type: "api_key",
			key: "!echo leaked",
		}));

		expect(await store.read("openrouter")).toEqual({
			type: "api_key",
			key: "$HOME",
		});
		expect(await store.read("other")).toEqual({
			type: "api_key",
			key: "!echo leaked",
		});
	});

	it("writes a private file and keeps entries it cannot parse", async () => {
		const authPath = path.join(dir, "auth.json");
		writeFileSync(authPath, JSON.stringify({ future: { type: "passkey" } }));
		const store = new FileCredentialStore(authPath);

		await store.modify("openrouter", async () => ({
			type: "api_key",
			key: "stored",
		}));

		expect(statSync(authPath).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
			future: { type: "passkey" },
			openrouter: { type: "api_key", key: "stored" },
		});
		expect(await store.list()).toEqual([
			{ providerId: "openrouter", type: "api_key" },
		]);
	});

	it("leaves an entry unchanged when the update returns undefined", async () => {
		const store = new FileCredentialStore(path.join(dir, "auth.json"));
		const refreshed = {
			type: "oauth" as const,
			access: "fresh-access",
			refresh: "fresh-refresh",
			expires: Date.now() + 60_000,
		};

		// Two requests race to refresh: the second sees the first's result
		// and returns undefined, which must keep the refreshed credential.
		const [first, second] = await Promise.all([
			store.modify("openai-codex", async () => refreshed),
			store.modify("openai-codex", async (current) =>
				current?.type === "oauth" && current.access === "fresh-access"
					? undefined
					: refreshed,
			),
		]);

		expect(first).toEqual(refreshed);
		expect(second).toEqual(refreshed);
		expect(await store.read("openai-codex")).toEqual(refreshed);
	});

	it("does not write when the operation was aborted", async () => {
		const store = new FileCredentialStore(path.join(dir, "auth.json"));
		const controller = new AbortController();

		await expect(
			store.modify(
				"openrouter",
				async () => {
					controller.abort();
					return { type: "api_key", key: "late" };
				},
				{ signal: controller.signal },
			),
		).rejects.toThrow();
		expect(await store.read("openrouter")).toBeUndefined();
	});

	it("serializes concurrent modifications of the same file", async () => {
		const authPath = path.join(dir, "auth.json");
		const first = new FileCredentialStore(authPath);
		const second = new FileCredentialStore(authPath);

		await Promise.all(
			["a", "b", "c", "d"].map((provider, index) =>
				(index % 2 ? first : second).modify(provider, async () => {
					await new Promise((resolve) => setTimeout(resolve, 5));
					return { type: "api_key", key: provider };
				}),
			),
		);

		expect(
			Object.keys(JSON.parse(readFileSync(authPath, "utf8"))).sort(),
		).toEqual(["a", "b", "c", "d"]);
	});
});
