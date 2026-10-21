import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
	handlers: new Map<string, (value: Record<string, unknown>) => unknown>(),
	capture: vi.fn(),
	track: vi.fn(),
}));
vi.mock("../events/event-bus", () => ({
	on: (event: string, handler: (value: Record<string, unknown>) => unknown) =>
		fixtures.handlers.set(event, handler),
}));
vi.mock("@infinitune/shared/telemetry-node", () => ({
	captureError: fixtures.capture,
}));
vi.mock("./umami", () => ({ trackServerEvent: fixtures.track }));
vi.mock("../services/song-service", () => ({
	getById: vi.fn().mockResolvedValue({
		createdAt: 1,
		llmProvider: "ollama",
		llmModel: "text-model",
		errorMessage: "private prompt/provider output",
	}),
}));
vi.mock("../services/playlist-service", () => ({
	getById: vi.fn().mockResolvedValue({ aceModel: "audio-model" }),
}));
vi.mock("../services/settings-service", () => ({
	get: vi.fn().mockResolvedValue("default"),
}));

import { startTelemetryEvents } from "./events";

describe("pipeline telemetry", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		fixtures.handlers.clear();
		vi.clearAllMocks();
	});
	it("does no subscription or database work when disabled", () => {
		startTelemetryEvents();
		expect(fixtures.handlers.size).toBe(0);
	});
	it("reports every retry and terminal failure with stage/provider/model, excluding raw errors", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", "false");
		vi.stubEnv("GLITCHTIP_DSN", "configured");
		startTelemetryEvents();
		const handler = fixtures.handlers.get("song.status_changed");
		for (const to of ["retry_pending", "error"])
			await handler?.({
				songId: "song",
				playlistId: "playlist",
				from: "generating_audio",
				to,
			});
		expect(fixtures.capture).toHaveBeenCalledTimes(2);
		expect(fixtures.capture).toHaveBeenCalledWith(
			expect.objectContaining({ name: "PipelineError" }),
			expect.objectContaining({
				songId: "song",
				playlistId: "playlist",
				stage: "generating_audio",
				provider: "ace-step",
				model: "audio-model",
			}),
			["song-pipeline", "generating_audio", "PipelineError"],
		);
		expect(fixtures.track).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(fixtures.track.mock.calls)).not.toContain("private");
	});

	it("captures the original error with a stage fingerprint and full failure context", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", "false");
		vi.stubEnv("GLITCHTIP_DSN", "configured");
		startTelemetryEvents();
		const error = new TypeError("Provider failed");
		await fixtures.handlers.get("song.status_changed")?.({
			songId: "song",
			playlistId: "playlist",
			from: "generating_metadata",
			to: "retry_pending",
			failure: { error, stage: "generating_metadata" },
		});
		expect(fixtures.capture).toHaveBeenCalledExactlyOnceWith(
			error,
			{
				songId: "song",
				playlistId: "playlist",
				stage: "generating_metadata",
				provider: "ollama",
				model: "text-model",
				status: "retry_pending",
			},
			["song-pipeline", "generating_metadata", "TypeError"],
		);
		expect(fixtures.track).toHaveBeenCalledExactlyOnceWith(
			"song_generation_failed",
			expect.objectContaining({
				error_class: "PipelineError",
				status: "retry_pending",
			}),
		);
	});
	it("uses the pre-revert audio failure stage for provider, model and fingerprint", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("VITEST", "false");
		vi.stubEnv("GLITCHTIP_DSN", "configured");
		startTelemetryEvents();
		const error = new Error("ACE task not found");
		await fixtures.handlers.get("song.status_changed")?.({
			songId: "song",
			playlistId: "playlist",
			from: "metadata_ready",
			to: "retry_pending",
			failure: { error, stage: "generating_audio" },
		});
		expect(fixtures.capture).toHaveBeenCalledExactlyOnceWith(
			error,
			{
				songId: "song",
				playlistId: "playlist",
				stage: "generating_audio",
				provider: "ace-step",
				model: "audio-model",
				status: "retry_pending",
			},
			["song-pipeline", "generating_audio", "Error"],
		);
		expect(fixtures.track).toHaveBeenCalledExactlyOnceWith(
			"song_generation_failed",
			expect.objectContaining({
				provider: "ace-step",
				model: "audio-model",
				stage: "generating_audio",
			}),
		);
	});
});
