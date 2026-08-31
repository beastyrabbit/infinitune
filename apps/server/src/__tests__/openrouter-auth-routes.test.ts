import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUserActor: vi.fn(),
	enhancePlaylistPrompt: vi.fn(),
	getOpenRouterApiKey: vi.fn(),
	getLocalOpenRouterCredentialStatus: vi.fn(),
	getOpenRouterCredentialStatus: vi.fn(),
	saveOpenRouterApiKey: vi.fn(),
	saveOpenRouterApiKeyForUser: vi.fn(),
	clearOpenRouterApiKey: vi.fn(),
	clearOpenRouterApiKeyForUser: vi.fn(),
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

vi.mock("../external/openrouter-auth", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../external/openrouter-auth")>();
	return {
		...actual,
		getOpenRouterApiKey: mocks.getOpenRouterApiKey,
		getLocalOpenRouterCredentialStatus:
			mocks.getLocalOpenRouterCredentialStatus,
		getOpenRouterCredentialStatus: mocks.getOpenRouterCredentialStatus,
		saveOpenRouterApiKey: mocks.saveOpenRouterApiKey,
		saveOpenRouterApiKeyForUser: mocks.saveOpenRouterApiKeyForUser,
		clearOpenRouterApiKey: mocks.clearOpenRouterApiKey,
		clearOpenRouterApiKeyForUser: mocks.clearOpenRouterApiKeyForUser,
	};
});

import {
	OpenRouterApiKeyValidationError,
	OpenRouterCredentialAccessError,
} from "../external/openrouter-auth";
import autoplayerRoutes from "../routes/autoplayer";

describe("OpenRouter credential routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireUserActor.mockResolvedValue(null);
		const status = {
			configured: false,
			source: null,
			canManage: true,
			setupAllowed: true,
			claimRequired: false,
			managedExternally: false,
		};
		mocks.getLocalOpenRouterCredentialStatus.mockResolvedValue(status);
		mocks.getOpenRouterCredentialStatus.mockResolvedValue(status);
		mocks.saveOpenRouterApiKey.mockResolvedValue({
			configured: true,
			source: "stored",
		});
		mocks.saveOpenRouterApiKeyForUser.mockResolvedValue({
			...status,
			configured: true,
			source: "stored",
			setupAllowed: false,
		});
		mocks.clearOpenRouterApiKey.mockResolvedValue({
			configured: false,
			source: null,
		});
		mocks.clearOpenRouterApiKeyForUser.mockResolvedValue(status);
		mocks.enhancePlaylistPrompt.mockResolvedValue("enhanced");
	});

	afterEach(() => vi.unstubAllEnvs());

	it("requires a user for production credential status and mutations", async () => {
		vi.stubEnv("NODE_ENV", "production");

		const statusResponse = await autoplayerRoutes.request("/openrouter-auth");
		const saveResponse = await autoplayerRoutes.request("/openrouter-auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: "placeholder" }),
		});
		const clearResponse = await autoplayerRoutes.request("/openrouter-auth", {
			method: "DELETE",
		});

		expect(statusResponse.status).toBe(401);
		expect(saveResponse.status).toBe(401);
		expect(clearResponse.status).toBe(401);
		expect(mocks.saveOpenRouterApiKey).not.toHaveBeenCalled();
		expect(mocks.saveOpenRouterApiKeyForUser).not.toHaveBeenCalled();
		expect(mocks.clearOpenRouterApiKey).not.toHaveBeenCalled();
		expect(mocks.clearOpenRouterApiKeyForUser).not.toHaveBeenCalled();
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
		expect(mocks.saveOpenRouterApiKeyForUser).toHaveBeenCalledWith(
			"placeholder",
			"user-1",
		);
	});

	it("keeps shared OpenRouter use available while denying non-owner mutation", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-2",
		});
		mocks.saveOpenRouterApiKeyForUser.mockRejectedValue(
			new OpenRouterCredentialAccessError(),
		);

		const mutationResponse = await autoplayerRoutes.request(
			"/openrouter-auth",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ apiKey: "placeholder" }),
			},
		);
		const useResponse = await autoplayerRoutes.request("/enhance-prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "openrouter",
				model: "auto",
				prompt: "playlist",
			}),
		});

		expect(mutationResponse.status).toBe(403);
		expect(await mutationResponse.json()).toEqual({
			error: "Credential management is not available",
		});
		expect(useResponse.status).toBe(200);
	});

	it("returns invalid API keys as client errors", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		mocks.saveOpenRouterApiKeyForUser.mockRejectedValue(
			new OpenRouterApiKeyValidationError(
				"OpenRouter API key must not be empty",
			),
		);

		const response = await autoplayerRoutes.request("/openrouter-auth", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ apiKey: " " }),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "OpenRouter API key must not be empty",
		});
	});

	it("returns a bounded error when auth status storage fails", async () => {
		mocks.getLocalOpenRouterCredentialStatus.mockRejectedValue(
			new Error("storage detail"),
		);

		const response = await autoplayerRoutes.request("/openrouter-auth");

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Failed to read OpenRouter auth status",
		});
	});
});
