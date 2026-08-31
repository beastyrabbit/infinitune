import { eq } from "drizzle-orm";
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

	it("never exposes legacy OpenRouter credentials through settings reads", async () => {
		await getTestDb().insert(settings).values({
			key: "openrouterApiKey",
			value: "legacy-secret-value",
		});

		expect(await settingsService.get("openrouterApiKey")).toBeNull();
		expect(await settingsService.getAll()).not.toHaveProperty(
			"openrouterApiKey",
		);
	});

	it("rejects credential writes through the generic settings service", async () => {
		await expect(
			settingsService.set("openrouterApiKey", "secret-value"),
		).rejects.toThrow("dedicated credential endpoint");
		expect(await settingsService.get("openrouterApiKey")).toBeNull();
	});

	it("removes a legacy key only after its protected replacement is written", async () => {
		await getTestDb().insert(settings).values({
			key: "openrouterApiKey",
			value: "legacy-test-value",
		});
		let replacementWritten = false;

		await settingsService.migrateSensitiveSetting(
			"openrouterApiKey",
			(value) => {
				expect(value).toBe("legacy-test-value");
				replacementWritten = true;
			},
		);

		expect(replacementWritten).toBe(true);
		expect(
			await getTestDb()
				.select()
				.from(settings)
				.where(eq(settings.key, "openrouterApiKey")),
		).toHaveLength(0);
	});

	it("keeps a legacy key if protected storage rejects the migration", async () => {
		await getTestDb().insert(settings).values({
			key: "openrouterApiKey",
			value: "legacy-test-value",
		});

		await expect(
			settingsService.migrateSensitiveSetting("openrouterApiKey", () => {
				throw new Error("protected storage unavailable");
			}),
		).rejects.toThrow("protected storage unavailable");
		expect(
			await getTestDb()
				.select()
				.from(settings)
				.where(eq(settings.key, "openrouterApiKey")),
		).toHaveLength(1);
	});
});
