import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, setupTestDb, teardownTestDb } from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
}));

vi.mock("../events/event-bus", () => ({ emit: vi.fn() }));

import {
	clearOpenRouterApiKey,
	clearOpenRouterApiKeyForUser,
	OpenRouterCredentialAccessError,
	saveOpenRouterApiKey,
	saveOpenRouterApiKeyForUser,
} from "../external/openrouter-auth";
import { createPiRuntimeHandles } from "../external/pi-runtime";
import * as settingsService from "../services/settings-service";

describe("OpenRouter credential ownership", () => {
	let agentDir: string;
	let previousAgentDir: string | undefined;
	let previousCodexHome: string | undefined;
	let previousEnvironmentKey: string | undefined;

	beforeEach(() => {
		setupTestDb();
		agentDir = mkdtempSync(path.join(tmpdir(), "infinitune-owner-"));
		previousAgentDir = process.env.INFINITUNE_PI_AGENT_DIR;
		previousCodexHome = process.env.CODEX_HOME;
		previousEnvironmentKey = process.env.OPENROUTER_API_KEY;
		process.env.INFINITUNE_PI_AGENT_DIR = agentDir;
		process.env.CODEX_HOME = path.join(agentDir, "codex");
		delete process.env.OPENROUTER_API_KEY;
	});

	afterEach(() => {
		teardownTestDb();
		rmSync(agentDir, { recursive: true, force: true });
		if (previousAgentDir === undefined) {
			delete process.env.INFINITUNE_PI_AGENT_DIR;
		} else {
			process.env.INFINITUNE_PI_AGENT_DIR = previousAgentDir;
		}
		if (previousCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = previousCodexHome;
		}
		if (previousEnvironmentKey === undefined) {
			delete process.env.OPENROUTER_API_KEY;
		} else {
			process.env.OPENROUTER_API_KEY = previousEnvironmentKey;
		}
	});

	it("allows exactly one user to win concurrent first setup", async () => {
		const results = await Promise.allSettled([
			saveOpenRouterApiKeyForUser("key-from-user-1", "user-1"),
			saveOpenRouterApiKeyForUser("key-from-user-2", "user-2"),
		]);
		const owner = await settingsService.getOpenRouterCredentialOwnerUserId();
		const stored = createPiRuntimeHandles().authStorage.get("openrouter");

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = results.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		expect(rejected?.reason).toBeInstanceOf(OpenRouterCredentialAccessError);
		expect(owner === "user-1" || owner === "user-2").toBe(true);
		expect(stored).toEqual({
			type: "api_key",
			key: owner === "user-1" ? "key-from-user-1" : "key-from-user-2",
		});
	});

	it("claims an existing stored key without rewriting it, then lets only the owner rotate and clear", async () => {
		await saveOpenRouterApiKey("existing-key");
		const authPath = path.join(agentDir, "auth.json");
		const beforeClaim = readFileSync(authPath, "utf8");

		const claimed = await saveOpenRouterApiKeyForUser("existing-key", "user-1");

		expect(claimed.canManage).toBe(true);
		expect(readFileSync(authPath, "utf8")).toBe(beforeClaim);
		expect(await settingsService.getOpenRouterCredentialOwnerUserId()).toBe(
			"user-1",
		);

		await expect(
			saveOpenRouterApiKeyForUser("replacement", "user-2"),
		).rejects.toBeInstanceOf(OpenRouterCredentialAccessError);
		await saveOpenRouterApiKeyForUser("replacement", "user-1");
		expect(createPiRuntimeHandles().authStorage.get("openrouter")).toEqual({
			type: "api_key",
			key: "replacement",
		});

		const cleared = await clearOpenRouterApiKeyForUser("user-1");
		expect(cleared.configured).toBe(false);
		expect(await settingsService.getOpenRouterCredentialOwnerUserId()).toBe(
			"user-1",
		);
		await expect(
			saveOpenRouterApiKeyForUser("new-key", "user-2"),
		).rejects.toBeInstanceOf(OpenRouterCredentialAccessError);
	});

	it("does not let users claim the wrong stored key or shadow an environment key", async () => {
		await saveOpenRouterApiKey("existing-key");
		await expect(
			saveOpenRouterApiKeyForUser("wrong-key", "user-1"),
		).rejects.toBeInstanceOf(OpenRouterCredentialAccessError);
		expect(
			await settingsService.getOpenRouterCredentialOwnerUserId(),
		).toBeNull();
		expect(createPiRuntimeHandles().authStorage.get("openrouter")).toEqual({
			type: "api_key",
			key: "existing-key",
		});

		await clearOpenRouterApiKey();
		process.env.OPENROUTER_API_KEY = "environment-key";
		await expect(
			saveOpenRouterApiKeyForUser("replacement", "user-1"),
		).rejects.toBeInstanceOf(OpenRouterCredentialAccessError);
		expect(
			await settingsService.getOpenRouterCredentialOwnerUserId(),
		).toBeNull();
		expect(
			createPiRuntimeHandles().authStorage.get("openrouter"),
		).toBeUndefined();
	});
});
