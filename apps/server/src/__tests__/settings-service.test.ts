import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, setupTestDb, teardownTestDb } from "./test-db";

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
}));

vi.mock("../events/event-bus", () => ({ emit: vi.fn() }));

import { settings } from "../db/schema";
import * as settingsService from "../services/settings-service";

describe("settings-service cache", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	it("does not expose the cached object by reference", async () => {
		await getTestDb()
			.insert(settings)
			.values({ key: "example", value: "stored" });
		const first = await settingsService.getAll();
		first.example = "mutated";

		expect((await settingsService.getAll()).example).toBe("stored");
	});

	it("populates the shared cache on a single-key miss", async () => {
		await getTestDb()
			.insert(settings)
			.values({ key: "example", value: "first" });
		expect(await settingsService.get("example")).toBe("first");

		await getTestDb().update(settings).set({ value: "changed-behind-cache" });
		expect(await settingsService.get("example")).toBe("first");
	});

	it("does not resolve inherited object keys as settings", async () => {
		expect(await settingsService.get("toString")).toBeNull();
		expect(await settingsService.get("constructor")).toBeNull();
		expect(await settingsService.get("__proto__")).toBeNull();
	});

	it("invalidates the cache after a service write", async () => {
		await settingsService.set("example", "first");
		expect(await settingsService.get("example")).toBe("first");
		await settingsService.set("example", "second");
		expect(await settingsService.get("example")).toBe("second");
	});
});
