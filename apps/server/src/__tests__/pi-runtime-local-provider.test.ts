import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getTestDb, getTestSqlite } from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue(null),
	getAll: vi.fn().mockResolvedValue({}),
	migrateSensitiveSetting: vi.fn().mockResolvedValue(false),
}));

import { piCompleteText, promptInfinituneAgent } from "../external/pi-runtime";

/**
 * Runs the real Pi SDK session and completion paths against a local
 * OpenAI-compatible server registered through models.json, so no external
 * provider is contacted.
 */
describe("Pi runtime against a local OpenAI-compatible provider", () => {
	let agentDir: string;
	let server: http.Server;
	const requests: Array<{
		model: string;
		stream: boolean;
		messages: unknown[];
		tools: string[];
	}> = [];
	const previousEnv = {
		agentDir: process.env.INFINITUNE_PI_AGENT_DIR,
		codexHome: process.env.CODEX_HOME,
	};

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				const payload = JSON.parse(body || "{}");
				requests.push({
					model: payload.model,
					stream: payload.stream === true,
					messages: payload.messages ?? [],
					tools: (payload.tools ?? []).map(
						(tool: { function?: { name?: string } }) => tool.function?.name,
					),
				});
				res.writeHead(200, { "content-type": "text/event-stream" });
				const chunk = (delta: object, finish: string | null) =>
					`data: ${JSON.stringify({
						id: "chatcmpl-local",
						object: "chat.completion.chunk",
						created: 0,
						model: payload.model,
						choices: [{ index: 0, delta, finish_reason: finish }],
					})}\n\n`;
				res.write(chunk({ role: "assistant", content: "local " }, null));
				res.write(chunk({ content: "reply" }, null));
				res.write(chunk({}, "stop"));
				res.end("data: [DONE]\n\n");
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const port = (server.address() as AddressInfo).port;

		agentDir = mkdtempSync(path.join(tmpdir(), "infinitune-pi-local-"));
		process.env.INFINITUNE_PI_AGENT_DIR = agentDir;
		// Keep the developer's real Codex login out of the test agent dir.
		process.env.CODEX_HOME = path.join(agentDir, "codex");
		writeFileSync(
			path.join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					"local-test": {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						api: "openai-completions",
						apiKey: "local-test-key",
						models: [{ id: "echo" }],
					},
				},
			}),
		);
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(agentDir, { recursive: true, force: true });
		for (const [key, value] of [
			["INFINITUNE_PI_AGENT_DIR", previousEnv.agentDir],
			["CODEX_HOME", previousEnv.codexHome],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("completes text through ModelRuntime.completeSimple", async () => {
		await expect(
			piCompleteText({
				provider: "local-test" as never,
				model: "echo",
				system: "system prompt",
				prompt: "user prompt",
			}),
		).resolves.toBe("local reply");
		expect(requests.at(-1)).toMatchObject({ model: "echo", stream: true });
	});

	it("runs a real agent session with Infinitune tools and system prompt", async () => {
		const text = await promptInfinituneAgent({
			agentId: "playlist-director",
			prompt: "Plan the next song",
			modelProfile: { provider: "local-test" as never, model: "echo" },
		});

		expect(text).toBe("local reply");
		const messages = JSON.stringify(requests.at(-1)?.messages);
		expect(messages).toContain("Plan the next song");
		expect(messages).toContain("for Infinitune");
		expect(requests.at(-1)?.tools.length).toBeGreaterThan(0);
	});
});
