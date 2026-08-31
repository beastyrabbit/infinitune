import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/device-service", () => ({
	authenticateDeviceToken: vi.fn(),
}));

import { getDeviceActor } from "../auth/device";
import * as deviceService from "../services/device-service";

const app = new Hono().get("/", async (c) => c.json(await getDeviceActor(c)));

describe("device actor resolution", () => {
	beforeEach(() => {
		vi.mocked(deviceService.authenticateDeviceToken).mockReset();
	});

	it("authenticates the x-device-token header", async () => {
		vi.mocked(deviceService.authenticateDeviceToken).mockResolvedValue({
			id: "device-1",
			createdAt: 1,
			name: "Living room",
			tokenHash: "redacted",
			status: "active",
			ownerUserId: "user-1",
			lastSeenAt: null,
			capabilities: undefined,
			daemonVersion: null,
		});

		const response = await app.request("/", {
			headers: { "x-device-token": "device-token" },
		});

		expect(response.status).toBe(200);
		expect(deviceService.authenticateDeviceToken).toHaveBeenCalledWith(
			"device-token",
		);
		expect(await response.json()).toEqual({
			kind: "device",
			deviceId: "device-1",
			ownerUserId: "user-1",
		});
	});

	it("does not authenticate requests without the header", async () => {
		const response = await app.request("/");
		expect(await response.json()).toBeNull();
		expect(deviceService.authenticateDeviceToken).not.toHaveBeenCalled();
	});
});
