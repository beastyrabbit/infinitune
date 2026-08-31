import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUserActor: vi.fn(),
	startCodexDeviceAuth: vi.fn(),
	getCodexDeviceAuthStatus: vi.fn(),
	getCodexLoginStatus: vi.fn(),
	cancelCodexDeviceAuth: vi.fn(),
}));

vi.mock("../auth/actor", () => ({
	requireUserActor: mocks.requireUserActor,
}));

vi.mock("../external/codex-auth", () => ({
	startCodexDeviceAuth: mocks.startCodexDeviceAuth,
	getCodexDeviceAuthStatus: mocks.getCodexDeviceAuthStatus,
	getCodexLoginStatus: mocks.getCodexLoginStatus,
	cancelCodexDeviceAuth: mocks.cancelCodexDeviceAuth,
}));

let resetRateLimiters: (() => void) | undefined;

afterEach(() => {
	resetRateLimiters?.();
	resetRateLimiters = undefined;
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("Codex credential routes", () => {
	it("requires a production user before reading or changing shared auth", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mocks.requireUserActor.mockResolvedValue(null);

		const [{ default: autoplayerRoutes }, rateLimitModule] = await Promise.all([
			import("../routes/autoplayer"),
			import("../middleware/rate-limit"),
		]);
		resetRateLimiters = rateLimitModule.resetRateLimiters;

		const requests = [
			autoplayerRoutes.request("/codex-auth/status"),
			autoplayerRoutes.request("/codex-auth/start", { method: "POST" }),
			autoplayerRoutes.request("/codex-auth/cancel", { method: "POST" }),
			autoplayerRoutes.request("/codex-auth/upload-cache", { method: "POST" }),
		];

		expect(
			await Promise.all(requests).then((responses) =>
				responses.map((r) => r.status),
			),
		).toEqual([401, 401, 401, 401]);
		expect(mocks.startCodexDeviceAuth).not.toHaveBeenCalled();
		expect(mocks.getCodexDeviceAuthStatus).not.toHaveBeenCalled();
		expect(mocks.getCodexLoginStatus).not.toHaveBeenCalled();
		expect(mocks.cancelCodexDeviceAuth).not.toHaveBeenCalled();
	});

	it("authenticates before applying the shared credential mutation limit", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("RATE_LIMIT_CREDENTIAL_MUTATIONS_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_CREDENTIAL_MUTATIONS_GLOBAL_PER_MIN", "1");
		mocks.requireUserActor.mockResolvedValue(null);
		mocks.startCodexDeviceAuth.mockResolvedValue({ id: "session-1" });

		const [{ default: autoplayerRoutes }, rateLimitModule] = await Promise.all([
			import("../routes/autoplayer"),
			import("../middleware/rate-limit"),
		]);
		resetRateLimiters = rateLimitModule.resetRateLimiters;

		expect(
			(await autoplayerRoutes.request("/codex-auth/start", { method: "POST" }))
				.status,
		).toBe(401);
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		expect(
			(await autoplayerRoutes.request("/codex-auth/start", { method: "POST" }))
				.status,
		).toBe(200);
		expect(
			(await autoplayerRoutes.request("/codex-auth/start", { method: "POST" }))
				.status,
		).toBe(429);
		expect(mocks.startCodexDeviceAuth).toHaveBeenCalledOnce();
	});

	it("bounds authenticated credential status polling", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("RATE_LIMIT_CREDENTIAL_STATUS_PER_MIN", "1");
		vi.stubEnv("RATE_LIMIT_CREDENTIAL_STATUS_GLOBAL_PER_MIN", "1");
		mocks.requireUserActor.mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		mocks.getCodexDeviceAuthStatus.mockReturnValue(null);
		mocks.getCodexLoginStatus.mockResolvedValue({
			mode: "none",
			rawOutput: "",
		});

		const [{ default: autoplayerRoutes }, rateLimitModule] = await Promise.all([
			import("../routes/autoplayer"),
			import("../middleware/rate-limit"),
		]);
		resetRateLimiters = rateLimitModule.resetRateLimiters;

		expect((await autoplayerRoutes.request("/codex-auth/status")).status).toBe(
			200,
		);
		expect((await autoplayerRoutes.request("/codex-auth/status")).status).toBe(
			429,
		);
		expect(mocks.getCodexDeviceAuthStatus).toHaveBeenCalledOnce();
		expect(mocks.getCodexLoginStatus).toHaveBeenCalledOnce();
	});
});
