import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUserActor: vi.fn(),
	enhancePlaylistPrompt: vi.fn(),
	getOpenRouterApiKey: vi.fn(),
	getOpenRouterAuthStatus: vi.fn(),
	saveOpenRouterApiKey: vi.fn(),
	clearOpenRouterApiKey: vi.fn(),
}));

vi.mock("../auth/actor", () => ({
	requireUserActor: mocks.requireUserActor,
}));

vi.mock("../external/llm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../external/llm")>();
	return {
		...actual,
		enhancePlaylistPrompt: mocks.enhancePlaylistPrompt,
	};
});

vi.mock("../external/openrouter-auth", () => ({
	getOpenRouterApiKey: mocks.getOpenRouterApiKey,
	getOpenRouterAuthStatus: mocks.getOpenRouterAuthStatus,
	saveOpenRouterApiKey: mocks.saveOpenRouterApiKey,
	clearOpenRouterApiKey: mocks.clearOpenRouterApiKey,
}));

import autoplayerRoutes from "../routes/autoplayer";

describe("OpenRouter credential routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireUserActor.mockResolvedValue(null);
		mocks.getOpenRouterAuthStatus.mockResolvedValue({
			configured: false,
			source: null,
		});
		mocks.saveOpenRouterApiKey.mockResolvedValue({
			configured: true,
			source: "stored",
		});
		mocks.clearOpenRouterApiKey.mockResolvedValue({
			configured: false,
			source: null,
		});
		mocks.enhancePlaylistPrompt.mockResolvedValue("enhanced");
	});

	afterEach(() => vi.unstubAllEnvs());

	it("requires a user for production credential mutations", async () => {
		vi.stubEnv("NODE_ENV", "production");

		const saveResponse = await autoplayerRoutes.request("/openrouter-auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: "placeholder" }),
		});
		const clearResponse = await autoplayerRoutes.request("/openrouter-auth", {
			method: "DELETE",
		});

		expect(saveResponse.status).toBe(401);
		expect(clearResponse.status).toBe(401);
		expect(mocks.saveOpenRouterApiKey).not.toHaveBeenCalled();
		expect(mocks.clearOpenRouterApiKey).not.toHaveBeenCalled();
	});

	it.each([
		["/generate-song", { prompt: "song" }],
		[
			"/generate-album-track",
			{
				playlistPrompt: "album",
				sourceSong: {
					title: "Source",
					artistName: "Artist",
					genre: "rock",
					subGenre: "indie",
				},
				trackNumber: 1,
				totalTracks: 1,
			},
		],
		["/extract-persona", { song: {} }],
		["/enhance-prompt", { prompt: "playlist" }],
		["/enhance-request", { request: "request" }],
		["/refine-prompt", { currentPrompt: "current", direction: "heavier" }],
		["/enhance-session", { prompt: "session" }],
	])(
		"blocks anonymous production OpenRouter spending on %s",
		async (path, body) => {
			vi.stubEnv("NODE_ENV", "production");

			const response = await autoplayerRoutes.request(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					provider: "openrouter",
					model: "openai/gpt-5",
					...body,
				}),
			});

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				error: "Authentication is required to use the server OpenRouter key",
			});
		},
	);

	it("blocks anonymous production OpenRouter connection tests", async () => {
		vi.stubEnv("NODE_ENV", "production");

		const response = await autoplayerRoutes.request("/test-connection", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ provider: "openrouter" }),
		});

		expect(response.status).toBe(401);
		expect(mocks.getOpenRouterApiKey).not.toHaveBeenCalled();
	});

	it("allows an authenticated production user to select OpenRouter", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});

		const response = await autoplayerRoutes.request("/enhance-prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "openrouter",
				model: "auto",
				prompt: "playlist",
			}),
		});

		expect(response.status).toBe(200);
		expect(mocks.enhancePlaylistPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openrouter", model: "auto" }),
		);
	});

	it.each([
		["development", "openrouter"],
		["production", "openai-codex"],
	] as const)(
		"keeps %s %s prompt enhancement available without Shoo auth",
		async (nodeEnv, provider) => {
			vi.stubEnv("NODE_ENV", nodeEnv);

			const response = await autoplayerRoutes.request("/enhance-prompt", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					provider,
					model: provider === "openrouter" ? "auto" : "gpt-5.2",
					prompt: "playlist",
				}),
			});

			expect(response.status).toBe(200);
			expect(mocks.requireUserActor).not.toHaveBeenCalled();
		},
	);

	it("keeps local self-hosted credential setup available", async () => {
		vi.stubEnv("NODE_ENV", "development");

		const response = await autoplayerRoutes.request("/openrouter-auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: "placeholder" }),
		});

		expect(response.status).toBe(200);
		expect(mocks.saveOpenRouterApiKey).toHaveBeenCalledWith("placeholder");
		expect(mocks.requireUserActor).not.toHaveBeenCalled();
	});

	it("allows an authenticated production user to save a key", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});

		const response = await autoplayerRoutes.request("/openrouter-auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: "placeholder" }),
		});

		expect(response.status).toBe(200);
		expect(mocks.saveOpenRouterApiKey).toHaveBeenCalledWith("placeholder");
	});

	it("returns a bounded error when auth status storage fails", async () => {
		mocks.getOpenRouterAuthStatus.mockRejectedValue(
			new Error("storage detail"),
		);

		const response = await autoplayerRoutes.request("/openrouter-auth");

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Failed to read OpenRouter auth status",
		});
	});
});
