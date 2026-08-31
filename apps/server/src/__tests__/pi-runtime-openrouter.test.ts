import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	completeSimple: vi.fn(),
	createAgentSession: vi.fn(),
	getAll: vi.fn(),
	migrateSensitiveSetting: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@mariozechner/pi-ai")>();
	return { ...actual, completeSimple: mocks.completeSimple };
});

vi.mock("@mariozechner/pi-coding-agent", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@mariozechner/pi-coding-agent")>();
	return { ...actual, createAgentSession: mocks.createAgentSession };
});

vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue(null),
	getAll: mocks.getAll,
	migrateSensitiveSetting: mocks.migrateSensitiveSetting,
}));

import {
	createInfinituneAgentSession,
	createPiRuntimeHandles,
	migrateLegacyOpenRouterCredential,
	piCompleteText,
} from "../external/pi-runtime";

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
		mocks.completeSimple.mockReset();
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
		mocks.completeSimple.mockResolvedValue({
			content: [{ type: "text", text: "generated lyrics" }],
			stopReason: "stop",
		});

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
		expect(mocks.completeSimple).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "auto",
				provider: "openrouter",
			}),
			expect.any(Object),
			expect.objectContaining({
				apiKey: "legacy-test-key",
				reasoning: "medium",
			}),
		);
		expect(mocks.completeSimple.mock.calls[0]?.[2]).not.toHaveProperty(
			"temperature",
		);
	});

	it("sends temperature to non-reasoning OpenRouter models", async () => {
		process.env.OPENROUTER_API_KEY = "openrouter-test-key";
		mocks.completeSimple.mockResolvedValue({
			content: [{ type: "text", text: "openrouter text" }],
			stopReason: "stop",
		});

		await expect(
			piCompleteText({
				provider: "openrouter",
				model: "deepseek/deepseek-chat",
				system: "system",
				prompt: "prompt",
				temperature: 0.82,
			}),
		).resolves.toBe("openrouter text");

		expect(mocks.completeSimple.mock.calls[0]?.[2]).toHaveProperty(
			"temperature",
			0.82,
		);
	});

	it("does not send temperature to Codex reasoning models", async () => {
		const { authStorage } = createPiRuntimeHandles();
		authStorage.set("openai-codex", {
			type: "api_key",
			key: "codex-test-token",
		});
		expect(authStorage.drainErrors()).toEqual([]);
		mocks.completeSimple.mockResolvedValue({
			content: [{ type: "text", text: "codex text" }],
			stopReason: "stop",
		});

		await expect(
			piCompleteText({
				provider: "openai-codex",
				model: "gpt-5.2",
				system: "system",
				prompt: "prompt",
				temperature: 0.82,
			}),
		).resolves.toBe("codex text");

		const completionOptions = mocks.completeSimple.mock.calls[0]?.[2];
		expect(completionOptions).not.toHaveProperty("temperature");
		expect(completionOptions).toHaveProperty("reasoning", "medium");
	});

	it("keeps a newly stored key when a legacy migration uses a stale handle", async () => {
		const stale = createPiRuntimeHandles().authStorage;
		const current = createPiRuntimeHandles().authStorage;
		current.set("openrouter", {
			type: "api_key",
			key: "current-openrouter-key",
		});
		expect(current.drainErrors()).toEqual([]);
		mocks.migrateSensitiveSetting.mockImplementationOnce(
			async (_key, writeReplacement) => {
				await writeReplacement("legacy-openrouter-key");
				return true;
			},
		);

		await migrateLegacyOpenRouterCredential(stale);
		stale.reload();

		expect(await stale.getApiKey("openrouter")).toBe("current-openrouter-key");
	});

	it("keeps stored OpenRouter auth when seeding Codex auth", async () => {
		const initial = createPiRuntimeHandles().authStorage;
		initial.set("openrouter", {
			type: "api_key",
			key: "stored-openrouter-key",
		});
		expect(initial.drainErrors()).toEqual([]);

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

		const seeded = createPiRuntimeHandles().authStorage;

		expect(await seeded.getApiKey("openrouter")).toBe("stored-openrouter-key");
		expect(seeded.get("openai-codex")).toMatchObject({
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
		expect(mocks.completeSimple).not.toHaveBeenCalled();
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
