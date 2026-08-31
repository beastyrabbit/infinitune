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

	it("keeps the OpenRouter credential owner private", async () => {
		await getTestDb().insert(settings).values({
			key: "openrouterCredentialOwnerUserId",
			value: "user-1",
		});

		expect(await settingsService.getOpenRouterCredentialOwnerUserId()).toBe(
			"user-1",
		);
		expect(
			await settingsService.get("openrouterCredentialOwnerUserId"),
		).toBeNull();
		expect(await settingsService.getAll()).not.toHaveProperty(
			"openrouterCredentialOwnerUserId",
		);
	});

	it("rejects owner writes through the generic settings service", async () => {
		await expect(
			settingsService.set("openrouterCredentialOwnerUserId", "user-1"),
		).rejects.toThrow("dedicated credential endpoint");
		expect(
			await settingsService.getOpenRouterCredentialOwnerUserId(),
		).toBeNull();
	});

	it("claims OpenRouter credential ownership once without overwriting it", async () => {
		expect(
			await settingsService.claimOpenRouterCredentialOwner("user-1"),
		).toEqual({ status: "owner", claimed: true });
		expect(
			await settingsService.claimOpenRouterCredentialOwner("user-1"),
		).toEqual({ status: "owner", claimed: false });
		expect(
			await settingsService.claimOpenRouterCredentialOwner("user-2"),
		).toEqual({ status: "other", claimed: false });
		expect(await settingsService.getOpenRouterCredentialOwnerUserId()).toBe(
			"user-1",
		);
	});

	it("allows exactly one concurrent OpenRouter owner claim", async () => {
		const [first, second] = await Promise.all([
			settingsService.claimOpenRouterCredentialOwner("user-1"),
			settingsService.claimOpenRouterCredentialOwner("user-2"),
		]);
		const owner = await settingsService.getOpenRouterCredentialOwnerUserId();

		expect([first, second].filter((result) => result.claimed)).toHaveLength(1);
		expect(owner === "user-1" || owner === "user-2").toBe(true);
		expect(owner === "user-1" ? first.status : second.status).toBe("owner");
		expect(owner === "user-1" ? second.status : first.status).toBe("other");
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
