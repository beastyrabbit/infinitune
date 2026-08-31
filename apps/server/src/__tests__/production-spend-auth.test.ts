import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRequestActor: vi.fn(),
	requireUserActor: vi.fn(),
	getDeviceActor: vi.fn(),
	playlistCreate: vi.fn(),
	playlistGetById: vi.fn(),
	playlistUpdateParams: vi.fn(),
	playlistUpdateStatus: vi.fn(),
	playlistUpdatePosition: vi.fn(),
	playlistIncrementGenerated: vi.fn(),
	playlistResetDefaults: vi.fn(),
	playlistSteer: vi.fn(),
	playlistToggleStar: vi.fn(),
	playlistDelete: vi.fn(),
	playlistHeartbeat: vi.fn(),
	postHumanChat: vi.fn(),
	answerDirectorQuestion: vi.fn(),
	settingsGetAll: vi.fn(),
	settingsSet: vi.fn(),
	addFeedback: vi.fn(),
	topUpInventory: vi.fn(),
	submitRadioRequest: vi.fn(),
}));

vi.mock("../auth/actor", () => ({
	getRequestActor: mocks.getRequestActor,
	requireUserActor: mocks.requireUserActor,
}));

vi.mock("../auth/device", () => ({
	getDeviceActor: mocks.getDeviceActor,
}));

vi.mock("../agents/channel-store", () => ({
	readChannelMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("../agents/playlist-director-service", () => ({
	answerDirectorQuestion: mocks.answerDirectorQuestion,
	DirectorQuestionValidationError: class extends Error {},
	getPlaylistChatState: vi.fn().mockResolvedValue({}),
	initializePlaylistDirectorPlan: vi.fn().mockResolvedValue(undefined),
	MAX_HUMAN_CHAT_CONTENT_CHARS: 10_000,
	postHumanChat: mocks.postHumanChat,
}));

vi.mock("../events/event-bus", () => ({
	on: vi.fn(),
}));

vi.mock("../middleware/limiters", () => ({
	credentialMutationLimiter: async (
		_context: unknown,
		next: () => Promise<void>,
	) => next(),
	generationLimiter: async (_context: unknown, next: () => Promise<void>) =>
		next(),
	llmLimiter: async (_context: unknown, next: () => Promise<void>) => next(),
	radioControlLimiter: async (_context: unknown, next: () => Promise<void>) =>
		next(),
	radioFeedbackLimiter: async (_context: unknown, next: () => Promise<void>) =>
		next(),
	radioRequestLimiter: async (_context: unknown, next: () => Promise<void>) =>
		next(),
	stationPresetLimiter: async (_context: unknown, next: () => Promise<void>) =>
		next(),
}));

vi.mock("../services/playlist-service", () => ({
	announceCreated: vi.fn(),
	create: mocks.playlistCreate,
	deletePlaylist: mocks.playlistDelete,
	getById: mocks.playlistGetById,
	getByKey: vi.fn(),
	heartbeat: mocks.playlistHeartbeat,
	incrementGenerated: mocks.playlistIncrementGenerated,
	listActive: vi.fn().mockResolvedValue([]),
	listAll: vi.fn().mockResolvedValue([]),
	listClosed: vi.fn().mockResolvedValue([]),
	resetDefaults: mocks.playlistResetDefaults,
	steer: mocks.playlistSteer,
	toggleStar: mocks.playlistToggleStar,
	updateParams: mocks.playlistUpdateParams,
	updatePosition: mocks.playlistUpdatePosition,
	updateStatus: mocks.playlistUpdateStatus,
}));

vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue(null),
	getAll: mocks.settingsGetAll,
	isSensitiveSettingKey: (key: string) => key === "openrouterApiKey",
	set: mocks.settingsSet,
}));

vi.mock("../services/album-generation-service", () => ({
	getInventoryStats: vi.fn().mockReturnValue({}),
	getRadioAnalytics: vi.fn().mockReturnValue({}),
	listRadioAlbums: vi.fn().mockResolvedValue([]),
	topUpInventory: mocks.topUpInventory,
}));

vi.mock("../services/cover-source-service", () => ({
	addCoverSource: vi.fn(),
	deleteCoverSource: vi.fn(),
	getNasStatus: vi.fn().mockReturnValue({}),
	getRadioSourceSettings: vi.fn().mockResolvedValue({ sourceLibraryDir: "" }),
	listCoverSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/radio-request-service", () => ({
	listRadioRequests: vi.fn().mockReturnValue([]),
	submitRadioRequest: mocks.submitRadioRequest,
}));

vi.mock("../services/radio-station-presets-service", () => ({
	activatePreset: vi.fn(),
	createPreset: vi.fn(),
	deletePreset: vi.fn(),
	listPresets: vi.fn().mockReturnValue([]),
	StationPresetLimitError: class extends Error {},
	updatePreset: vi.fn(),
}));

vi.mock("../services/radio-station-service", () => ({
	activateListener: vi.fn(),
	addFeedback: mocks.addFeedback,
	deactivateListener: vi.fn(),
	getStationSnapshot: vi.fn().mockReturnValue({}),
	heartbeatListener: vi.fn(),
	seekStation: vi.fn(),
	skipStation: vi.fn(),
}));

vi.mock("../services/song-service", () => ({
	listLegacy: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/songs/access", () => ({
	songReadAccess: vi.fn().mockResolvedValue({ ownerUserId: null }),
}));

import { handleRadioConnection } from "../radio/radio-ws-handler";
import playlistsRoutes from "../routes/playlists";
import radioRoutes from "../routes/radio";
import settingsRoutes from "../routes/settings";

const anonymous = { kind: "anonymous" as const };
const authenticated = { kind: "user" as const, userId: "user-1" };

function playlist(input?: {
	llmProvider?: string;
	ownerUserId?: string | null;
}) {
	return {
		id: "playlist-1",
		createdAt: 1,
		name: "Playlist",
		prompt: "music",
		llmProvider: input?.llmProvider ?? "openrouter",
		llmModel: "auto",
		mode: "endless",
		status: "active",
		songsGenerated: 0,
		steerHistory: null,
		managerPlan: null,
		ownerUserId: input?.ownerUserId ?? null,
		isTemporary: false,
	} as never;
}

function requestJson(
	app: typeof playlistsRoutes,
	path: string,
	method: "POST" | "PATCH" | "DELETE",
	body?: unknown,
) {
	return app.request(path, {
		method,
		headers:
			body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function fakeWebSocket() {
	const listeners = new Map<string, (value?: unknown) => void>();
	const sent: unknown[] = [];
	return {
		ws: {
			OPEN: 1,
			readyState: 1,
			on: vi.fn((event: string, listener: (value?: unknown) => void) => {
				listeners.set(event, listener);
			}),
			send: vi.fn((value: string) => sent.push(JSON.parse(value))),
		} as never,
		listeners,
		sent,
	};
}

describe("production OpenRouter spend authentication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("NODE_ENV", "production");
		mocks.getRequestActor.mockResolvedValue(anonymous);
		mocks.requireUserActor.mockResolvedValue(null);
		mocks.getDeviceActor.mockResolvedValue(null);
		mocks.playlistGetById.mockResolvedValue(playlist());
		mocks.playlistCreate.mockImplementation(async (input) =>
			playlist({
				llmProvider: input.llmProvider,
				ownerUserId: input.ownerUserId ?? null,
			}),
		);
		mocks.playlistToggleStar.mockResolvedValue({ isStarred: true });
		mocks.postHumanChat.mockResolvedValue({
			messageId: "message-1",
			committedDirection: false,
		});
		mocks.answerDirectorQuestion.mockResolvedValue({ messageId: "message-1" });
		mocks.settingsGetAll.mockResolvedValue({});
		mocks.addFeedback.mockResolvedValue({ station: {} });
		mocks.topUpInventory.mockResolvedValue({ created: 1 });
		mocks.submitRadioRequest.mockResolvedValue({ id: "request-1" });
	});

	afterEach(() => vi.unstubAllEnvs());

	it("blocks anonymous production playlist creation with OpenRouter", async () => {
		const response = await requestJson(playlistsRoutes, "/", "POST", {
			name: "OpenRouter playlist",
			prompt: "music",
			llmProvider: "openrouter",
			llmModel: "auto",
		});

		expect(response.status).toBe(401);
		expect(mocks.playlistCreate).not.toHaveBeenCalled();
	});

	it("rejects public creation of spoofed radio playlists", async () => {
		const response = await requestJson(playlistsRoutes, "/", "POST", {
			name: "Fake radio",
			prompt: "music",
			llmProvider: "openrouter",
			llmModel: "auto",
			mode: "radio",
			playlistKey: "fake-radio",
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Radio mode and key are reserved for the global server playlist",
		});
		expect(mocks.playlistCreate).not.toHaveBeenCalled();
	});

	it("rejects public reservation of the canonical radio key", async () => {
		const response = await requestJson(playlistsRoutes, "/", "POST", {
			name: "Fake radio key",
			prompt: "music",
			llmProvider: "openai-codex",
			llmModel: "gpt-5.2",
			mode: "endless",
			playlistKey: "global-radio",
		});

		expect(response.status).toBe(400);
		expect(mocks.playlistCreate).not.toHaveBeenCalled();
	});

	it("keeps anonymous Codex playlist creation available in production", async () => {
		const response = await requestJson(playlistsRoutes, "/", "POST", {
			name: "Codex playlist",
			prompt: "music",
			llmProvider: "openai-codex",
			llmModel: "gpt-5.2",
		});

		expect(response.status).toBe(200);
		expect(mocks.playlistCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				llmProvider: "openai-codex",
				ownerUserId: undefined,
				isTemporary: true,
			}),
		);
	});

	it("allows authenticated and local OpenRouter playlist creation", async () => {
		mocks.getRequestActor.mockResolvedValue(authenticated);
		const authenticatedResponse = await requestJson(
			playlistsRoutes,
			"/",
			"POST",
			{
				name: "Owned OpenRouter playlist",
				prompt: "music",
				llmProvider: "openrouter",
				llmModel: "auto",
			},
		);
		expect(authenticatedResponse.status).toBe(200);
		expect(mocks.playlistCreate).toHaveBeenLastCalledWith(
			expect.objectContaining({ ownerUserId: "user-1", isTemporary: false }),
		);

		vi.stubEnv("NODE_ENV", "development");
		mocks.getRequestActor.mockResolvedValue(anonymous);
		const localResponse = await requestJson(playlistsRoutes, "/", "POST", {
			name: "Local OpenRouter playlist",
			prompt: "music",
			llmProvider: "openrouter",
			llmModel: "auto",
		});
		expect(localResponse.status).toBe(200);
	});

	it("blocks an anonymous production switch from Codex to OpenRouter", async () => {
		mocks.playlistGetById.mockResolvedValue(
			playlist({ llmProvider: "openai-codex" }),
		);

		const response = await requestJson(
			playlistsRoutes,
			"/playlist-1/params",
			"PATCH",
			{ llmProvider: "openrouter", llmModel: "auto" },
		);

		expect(response.status).toBe(401);
		expect(mocks.playlistUpdateParams).not.toHaveBeenCalled();
	});

	it.each([
		["POST", "/playlist-1/agent-chat/messages", { content: "more guitars" }],
		[
			"POST",
			"/playlist-1/agent-chat/answer",
			{ questionId: "question-1", content: "yes" },
		],
		["PATCH", "/playlist-1/params", { audioDuration: 180 }],
		["PATCH", "/playlist-1/status", { status: "closing" }],
		["PATCH", "/playlist-1/prompt", { prompt: "more guitars" }],
		["POST", "/playlist-1/heartbeat", undefined],
	] as const)(
		"fails closed for anonymous ownerless OpenRouter mutation %s %s",
		async (method, path, body) => {
			const response = await requestJson(playlistsRoutes, path, method, body);

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({
				error: "Authentication is required to use the server OpenRouter key",
			});
		},
	);

	it("keeps authenticated OpenRouter and anonymous Codex mutations working", async () => {
		mocks.getRequestActor.mockResolvedValue(authenticated);
		mocks.playlistGetById.mockResolvedValue(
			playlist({ llmProvider: "openrouter", ownerUserId: "user-1" }),
		);
		const authenticatedResponse = await requestJson(
			playlistsRoutes,
			"/playlist-1/prompt",
			"PATCH",
			{ prompt: "authenticated direction" },
		);
		expect(authenticatedResponse.status).toBe(200);

		mocks.getRequestActor.mockResolvedValue(anonymous);
		mocks.playlistGetById.mockResolvedValue(
			playlist({ llmProvider: "openai-codex" }),
		);
		const codexResponse = await requestJson(
			playlistsRoutes,
			"/playlist-1/prompt",
			"PATCH",
			{ prompt: "anonymous direction" },
		);
		expect(codexResponse.status).toBe(200);
		expect(mocks.playlistSteer).toHaveBeenCalledTimes(2);
	});

	it("rejects authenticated OpenRouter use on a legacy ownerless playlist", async () => {
		mocks.getRequestActor.mockResolvedValue(authenticated);

		const response = await requestJson(
			playlistsRoutes,
			"/playlist-1/prompt",
			"PATCH",
			{ prompt: "authenticated but ownerless" },
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error:
				"Ownerless playlists cannot use OpenRouter in production; create an owned playlist instead",
		});
		expect(mocks.playlistSteer).not.toHaveBeenCalled();
	});

	it("keeps non-spending ownerless playlist mutations available", async () => {
		const responses = await Promise.all([
			requestJson(playlistsRoutes, "/playlist-1/position", "PATCH", {
				currentOrderIndex: 2,
			}),
			requestJson(playlistsRoutes, "/playlist-1/increment-generated", "POST"),
			requestJson(playlistsRoutes, "/playlist-1/reset-defaults", "POST"),
			requestJson(playlistsRoutes, "/playlist-1/star", "PATCH"),
		]);

		expect(responses.map((response) => response.status)).toEqual([
			200, 200, 200, 200,
		]);
		expect(mocks.playlistUpdatePosition).toHaveBeenCalled();
		expect(mocks.playlistIncrementGenerated).toHaveBeenCalled();
		expect(mocks.playlistResetDefaults).toHaveBeenCalled();
		expect(mocks.playlistToggleStar).toHaveBeenCalled();
	});

	it("allows anonymous callers to close or delete an ownerless OpenRouter playlist", async () => {
		const closeResponse = await requestJson(
			playlistsRoutes,
			"/playlist-1/status",
			"PATCH",
			{ status: "closed" },
		);
		const deleteResponse = await requestJson(
			playlistsRoutes,
			"/playlist-1",
			"DELETE",
		);

		expect(closeResponse.status).toBe(200);
		expect(deleteResponse.status).toBe(200);
	});

	it("guards global settings only in production", async () => {
		const productionResponse = await requestJson(settingsRoutes, "/", "POST", {
			key: "textProvider",
			value: "openrouter",
		});
		expect(productionResponse.status).toBe(401);
		expect(mocks.settingsSet).not.toHaveBeenCalled();

		mocks.requireUserActor.mockResolvedValue(authenticated);
		const authenticatedResponse = await requestJson(
			settingsRoutes,
			"/",
			"POST",
			{ key: "textProvider", value: "openrouter" },
		);
		expect(authenticatedResponse.status).toBe(200);

		vi.stubEnv("NODE_ENV", "development");
		mocks.requireUserActor.mockResolvedValue(null);
		const localResponse = await requestJson(settingsRoutes, "/", "POST", {
			key: "textModel",
			value: "auto",
		});
		expect(localResponse.status).toBe(200);
		expect(mocks.settingsSet).toHaveBeenCalledTimes(2);
	});

	it("reports when ACE_STEP_URL controls the effective settings value", async () => {
		vi.stubEnv("ACE_STEP_URL", "http://ace-from-env:8001");
		mocks.settingsGetAll.mockResolvedValue({
			aceStepUrl: "http://ace-from-db:8001",
		});

		const response = await settingsRoutes.request("/");

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			aceStepUrl: "http://ace-from-env:8001",
			aceStepUrlManagedByEnvironment: "true",
		});
	});

	it("guards manual radio generation in production", async () => {
		const forceResponse = await radioRoutes.request("/force-generate-album", {
			method: "POST",
		});
		expect(forceResponse.status).toBe(401);
		expect(mocks.topUpInventory).not.toHaveBeenCalled();

		mocks.requireUserActor.mockResolvedValue(authenticated);
		const authenticatedResponse = await radioRoutes.request(
			"/force-generate-album",
			{ method: "POST" },
		);
		expect(authenticatedResponse.status).toBe(200);
		expect(mocks.topUpInventory).toHaveBeenCalledWith({ force: true });
	});

	it("blocks anonymous production radio activation, seeking, and skipping", async () => {
		const playResponse = await requestJson(radioRoutes, "/play", "POST", {
			listenerId: "listener-1",
		});
		const seekResponse = await requestJson(radioRoutes, "/seek", "POST", {
			listenerId: "listener-1",
			offsetSeconds: 180,
		});
		const skipResponse = await requestJson(radioRoutes, "/skip", "POST", {
			listenerId: "listener-1",
		});

		expect(playResponse.status).toBe(401);
		expect(seekResponse.status).toBe(401);
		expect(skipResponse.status).toBe(401);
		expect(mocks.requireUserActor).toHaveBeenCalledTimes(3);
	});

	it("requires production authentication for radio feedback", async () => {
		const response = await requestJson(radioRoutes, "/feedback", "POST", {
			songId: "song-1",
			kind: "like",
		});

		expect(response.status).toBe(401);
		expect(mocks.addFeedback).not.toHaveBeenCalled();
	});

	it("returns 404 when an authenticated radio feedback target is not eligible", async () => {
		mocks.requireUserActor.mockResolvedValue(authenticated);
		mocks.addFeedback.mockResolvedValue(null);

		const response = await requestJson(radioRoutes, "/feedback", "POST", {
			songId: "missing-song",
			kind: "like",
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Radio song not found" });
	});

	it("allows authenticated production radio activation and skipping", async () => {
		mocks.requireUserActor.mockResolvedValue(authenticated);

		const playResponse = await requestJson(radioRoutes, "/play", "POST", {
			listenerId: "listener-1",
		});
		const skipResponse = await requestJson(radioRoutes, "/skip", "POST", {
			listenerId: "listener-1",
		});

		expect(playResponse.status).toBe(200);
		expect(skipResponse.status).toBe(200);
	});

	it("blocks anonymous production radio requests when OpenRouter is selected", async () => {
		mocks.settingsGetAll.mockResolvedValue({ textProvider: "openrouter" });

		const response = await requestJson(radioRoutes, "/requests", "POST", {
			prompt: "play a synthwave song",
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: "Authentication is required to use the server OpenRouter key",
		});
		expect(mocks.submitRadioRequest).not.toHaveBeenCalled();
	});

	it("allows authenticated production radio requests with OpenRouter", async () => {
		mocks.settingsGetAll.mockResolvedValue({ textProvider: "openrouter" });
		mocks.requireUserActor.mockResolvedValue(authenticated);

		const response = await requestJson(radioRoutes, "/requests", "POST", {
			prompt: "play a synthwave song",
		});

		expect(response.status).toBe(200);
		expect(mocks.submitRadioRequest).toHaveBeenCalledWith(
			"play a synthwave song",
		);
	});

	it("keeps anonymous Codex and local OpenRouter radio requests available", async () => {
		mocks.settingsGetAll.mockResolvedValue({ textProvider: "openai-codex" });
		const codexResponse = await requestJson(radioRoutes, "/requests", "POST", {
			prompt: "play a Codex-planned song",
		});
		expect(codexResponse.status).toBe(200);

		vi.stubEnv("NODE_ENV", "development");
		mocks.settingsGetAll.mockResolvedValue({ textProvider: "openrouter" });
		const localResponse = await requestJson(radioRoutes, "/requests", "POST", {
			prompt: "play a local OpenRouter song",
		});
		expect(localResponse.status).toBe(200);
		expect(mocks.submitRadioRequest).toHaveBeenCalledTimes(2);
	});

	it("rejects unrate-limited WebSocket radio requests in favor of REST", async () => {
		const socket = fakeWebSocket();
		handleRadioConnection(socket.ws);
		mocks.submitRadioRequest.mockClear();

		socket.listeners.get("message")?.(
			Buffer.from(JSON.stringify({ type: "request", prompt: "make an album" })),
		);
		await vi.waitFor(() => {
			expect(socket.sent).toContainEqual({
				type: "error",
				message: "Radio requests must use POST /api/radio/requests",
			});
		});
		expect(mocks.submitRadioRequest).not.toHaveBeenCalled();

		socket.listeners.get("close")?.();
	});

	it.each([
		["play", "Radio playback must use POST /api/radio/play"],
		["seek", "Radio seeking must use POST /api/radio/seek"],
		["skip", "Radio skipping must use POST /api/radio/skip"],
		["feedback", "Radio feedback must use POST /api/radio/feedback"],
	] as const)(
		"rejects production WebSocket %s commands that can trigger generation",
		async (type, message) => {
			const socket = fakeWebSocket();
			handleRadioConnection(socket.ws);

			socket.listeners.get("message")?.(
				Buffer.from(JSON.stringify({ type, listenerId: "listener-1" })),
			);
			await vi.waitFor(() => {
				expect(socket.sent).toContainEqual({ type: "error", message });
			});
			expect(mocks.addFeedback).not.toHaveBeenCalled();

			socket.listeners.get("close")?.();
		},
	);
});
