import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUserActor: vi.fn(),
	activateListener: vi.fn(),
	deactivateListener: vi.fn(),
	heartbeatListener: vi.fn(),
	addFeedback: vi.fn(),
	topUpInventory: vi.fn(),
	submitRadioRequest: vi.fn(),
	settingsGetAll: vi.fn(),
}));

vi.mock("../auth/actor", () => ({
	requireUserActor: mocks.requireUserActor,
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
	activateListener: mocks.activateListener,
	addFeedback: mocks.addFeedback,
	deactivateListener: mocks.deactivateListener,
	getStationSnapshot: vi.fn().mockReturnValue({}),
	heartbeatListener: mocks.heartbeatListener,
	seekStation: vi.fn(),
	skipStation: vi.fn(),
}));

vi.mock("../services/settings-service", () => ({
	getAll: mocks.settingsGetAll,
}));

vi.mock("../services/song-service", () => ({
	listLegacy: vi.fn().mockResolvedValue([]),
}));

vi.mock("../routes/songs/access", () => ({
	songReadAccess: vi.fn().mockResolvedValue({ ownerUserId: null }),
}));

let resetRateLimiters: (() => void) | undefined;

afterEach(() => {
	resetRateLimiters?.();
	resetRateLimiters = undefined;
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("radio control rate-limit ordering", () => {
	it("authenticates before limits and keeps playback controls separate from generation", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("RATE_LIMIT_GENERATION_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_GENERATION_GLOBAL_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_RADIO_CONTROLS_PER_MIN", "2");
		vi.stubEnv("RATE_LIMIT_RADIO_CONTROLS_GLOBAL_PER_MIN", "2");
		vi.stubEnv("RATE_LIMIT_RADIO_FEEDBACK_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_RADIO_FEEDBACK_GLOBAL_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_RADIO_REQUESTS_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_RADIO_REQUESTS_GLOBAL_PER_MIN", "1");
		mocks.requireUserActor.mockReset();
		mocks.requireUserActor.mockResolvedValue(null);
		mocks.activateListener.mockResolvedValue({ station: {} });
		mocks.deactivateListener.mockReturnValue({ station: {} });
		mocks.addFeedback.mockResolvedValue({ station: {} });
		mocks.topUpInventory.mockResolvedValue({ created: 1 });
		mocks.submitRadioRequest.mockResolvedValue({ id: "request-1" });
		mocks.settingsGetAll.mockResolvedValue({ textProvider: "openrouter" });

		const [{ default: radioRoutes }, rateLimitModule] = await Promise.all([
			import("../routes/radio"),
			import("../middleware/rate-limit"),
		]);
		resetRateLimiters = rateLimitModule.resetRateLimiters;

		for (const [path, body] of [
			["/play", { listenerId: "anonymous" }],
			["/pause", { listenerId: "anonymous" }],
			["/feedback", { songId: "song-1", kind: "like" }],
			["/force-generate-album", undefined],
			["/requests", { prompt: "anonymous request" }],
		] as const) {
			const response = await radioRoutes.request(path, {
				method: "POST",
				headers: body ? { "content-type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
			expect(response.status).toBe(401);
		}

		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		expect(
			(
				await radioRoutes.request("/play", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ listenerId: "authenticated" }),
				})
			).status,
		).toBe(200);
		expect(
			(
				await radioRoutes.request("/feedback", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ songId: "song-1", kind: "like" }),
				})
			).status,
		).toBe(200);
		expect(
			(
				await radioRoutes.request("/pause", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ listenerId: "authenticated" }),
				})
			).status,
		).toBe(200);
		expect(
			(
				await radioRoutes.request("/heartbeat", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ listenerId: "authenticated" }),
				})
			).status,
		).toBe(429);
		expect(
			(
				await radioRoutes.request("/feedback", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ songId: "song-1", kind: "like" }),
				})
			).status,
		).toBe(429);
		expect(
			(
				await radioRoutes.request("/force-generate-album", {
					method: "POST",
				})
			).status,
		).toBe(200);
		expect(
			(
				await radioRoutes.request("/requests", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ prompt: "authenticated request" }),
				})
			).status,
		).toBe(200);

		expect(mocks.activateListener).toHaveBeenCalledOnce();
		expect(mocks.deactivateListener).toHaveBeenCalledOnce();
		expect(mocks.heartbeatListener).not.toHaveBeenCalled();
		expect(mocks.addFeedback).toHaveBeenCalledOnce();
		expect(mocks.topUpInventory).toHaveBeenCalledOnce();
		expect(mocks.submitRadioRequest).toHaveBeenCalledOnce();
	});
});
