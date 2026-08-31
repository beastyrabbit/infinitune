import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsServiceMocks = vi.hoisted(() => ({
	migrateSensitiveSetting:
		vi.fn<
			(
				key: string,
				writeReplacement: (value: string) => void | Promise<void>,
			) => Promise<boolean>
		>(),
	deleteSensitiveSetting: vi.fn<(key: string) => Promise<void>>(),
}));

vi.mock("../services/settings-service", () => ({
	...settingsServiceMocks,
}));

import {
	clearOpenRouterApiKey,
	getOpenRouterApiKey,
	getOpenRouterAuthStatus,
	saveOpenRouterApiKey,
} from "../external/openrouter-auth";

describe("OpenRouter auth storage", () => {
	let agentDir: string;
	let previousAgentDir: string | undefined;
	let previousEnvironmentKey: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(path.join(tmpdir(), "infinitune-openrouter-auth-"));
		previousAgentDir = process.env.INFINITUNE_PI_AGENT_DIR;
		previousEnvironmentKey = process.env.OPENROUTER_API_KEY;
		process.env.INFINITUNE_PI_AGENT_DIR = agentDir;
		delete process.env.OPENROUTER_API_KEY;
		settingsServiceMocks.migrateSensitiveSetting.mockReset();
		settingsServiceMocks.migrateSensitiveSetting.mockResolvedValue(false);
		settingsServiceMocks.deleteSensitiveSetting.mockReset();
		settingsServiceMocks.deleteSensitiveSetting.mockResolvedValue();
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
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("stores the key in Pi auth without returning it in status", async () => {
		const status = await saveOpenRouterApiKey("  test-openrouter-key  ");

		expect(status).toEqual({ configured: true, source: "stored" });
		expect(await getOpenRouterApiKey()).toBe("test-openrouter-key");
		expect(await getOpenRouterAuthStatus()).toEqual({
			configured: true,
			source: "stored",
		});
		expect(await getOpenRouterAuthStatus()).not.toHaveProperty("apiKey");

		const authPath = path.join(agentDir, "auth.json");
		const stored = JSON.parse(readFileSync(authPath, "utf8")) as Record<
			string,
			unknown
		>;
		expect(stored.openrouter).toEqual({
			type: "api_key",
			key: "test-openrouter-key",
		});
		expect(statSync(authPath).mode & 0o777).toBe(0o600);
	});

	it("removes only the stored key", async () => {
		await saveOpenRouterApiKey("test-openrouter-key");

		expect(await clearOpenRouterApiKey()).toEqual({
			configured: false,
			source: null,
		});
		expect(await getOpenRouterApiKey()).toBeUndefined();
	});

	it("reports an environment key without exposing its value", async () => {
		process.env.OPENROUTER_API_KEY = "environment-test-key";

		expect(await getOpenRouterAuthStatus()).toEqual({
			configured: true,
			source: "environment",
		});
		expect(await getOpenRouterApiKey()).toBe("environment-test-key");
		expect(await clearOpenRouterApiKey()).toEqual({
			configured: true,
			source: "environment",
		});
	});

	it("moves a legacy database key into protected Pi auth", async () => {
		settingsServiceMocks.migrateSensitiveSetting.mockImplementationOnce(
			async (_key, writeReplacement) => {
				await writeReplacement("legacy-test-key");
				return true;
			},
		);

		expect(await getOpenRouterAuthStatus()).toEqual({
			configured: true,
			source: "stored",
		});
		expect(settingsServiceMocks.migrateSensitiveSetting).toHaveBeenCalledWith(
			"openrouterApiKey",
			expect.any(Function),
		);
		expect(await getOpenRouterApiKey()).toBe("legacy-test-key");
	});

	it("treats a pre-fix command-shaped stored key as inert text", async () => {
		writeFileSync(
			path.join(agentDir, "auth.json"),
			JSON.stringify({
				openrouter: { type: "api_key", key: "!printf should-not-run" },
			}),
			"utf8",
		);

		expect(await getOpenRouterApiKey()).toBe("!printf should-not-run");
	});

	it("rejects empty, oversized, and command-shaped keys", async () => {
		await expect(saveOpenRouterApiKey("   ")).rejects.toThrow(
			"must not be empty",
		);
		await expect(saveOpenRouterApiKey("x".repeat(4_097))).rejects.toThrow(
			"too long",
		);
		await expect(
			saveOpenRouterApiKey("!printf should-not-run"),
		).rejects.toThrow("must be a literal value");
	});
});
