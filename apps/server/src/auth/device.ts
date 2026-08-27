import type { Context } from "hono";
import * as deviceService from "../services/device-service";

export type DeviceActor = {
	kind: "device";
	deviceId: string;
	ownerUserId: string | null;
};

/** Resolve device credentials only for routes that explicitly allow them. */
export async function getDeviceActor(c: Context): Promise<DeviceActor | null> {
	const token = c.req.header("x-device-token");
	if (!token) return null;

	try {
		const device = await deviceService.authenticateDeviceToken(token);
		return device
			? {
					kind: "device",
					deviceId: device.id,
					ownerUserId: device.ownerUserId,
				}
			: null;
	} catch {
		return null;
	}
}
