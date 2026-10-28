import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
	withTelemetrySpan: vi.fn(
		(_name: string, _op: string, callback: () => unknown) => callback(),
	),
	updateTelemetrySpanName: vi.fn(),
}));
vi.mock("@infinitune/shared/telemetry-node", () => telemetry);

import { telemetryRequests } from "./requests";

beforeEach(() => vi.clearAllMocks());

function app() {
	return new Hono()
		.use("*", telemetryRequests)
		.get("/songs/:id", (c) => c.text("song"));
}

it.each(["/health", "/ws", "/ws/playlist", "/ws/radio"])(
	"skips %s",
	async (path) => {
		await app().request(path);
		expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
	},
);

it("skips Kubernetes probes regardless of path", async () => {
	await app().request("/songs/123", {
		headers: { "User-Agent": "kube-probe/1.35" },
	});
	expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
});

it("names transactions with the method and matched pattern, excluding IDs and query strings", async () => {
	const response = await app().request("/songs/private-id?token=private");
	expect(response.status).toBe(200);
	expect(telemetry.withTelemetrySpan).toHaveBeenCalledOnce();
	expect(telemetry.updateTelemetrySpanName).toHaveBeenCalledWith(
		"GET /songs/:id",
	);
});

it("uses a fixed name for unmatched requests", async () => {
	await app().request("/unknown/private-id");
	expect(telemetry.updateTelemetrySpanName).toHaveBeenCalledWith(
		"GET unmatched",
	);
});
