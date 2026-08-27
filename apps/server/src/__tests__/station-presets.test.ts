import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getTestDb,
	getTestSqlite,
	setupTestDb,
	teardownTestDb,
} from "./test-db";

vi.mock("../auth/actor", () => ({
	requireUserActor: vi.fn(),
}));

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
	get sqlite() {
		return getTestSqlite();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: vi.fn(),
	on: vi.fn(),
}));

import { requireUserActor } from "../auth/actor";
import { resetRateLimiters } from "../middleware/rate-limit";
import radioRoutes from "../routes/radio";
import * as presetService from "../services/radio-station-presets-service";

describe("radio-station-presets-service", () => {
	beforeEach(() => {
		resetRateLimiters();
		setupTestDb();
		vi.mocked(requireUserActor).mockResolvedValue(null);
	});

	afterEach(() => {
		resetRateLimiters();
		teardownTestDb();
	});

	it("creates presets as inactive by default", async () => {
		const preset = await presetService.createPreset({
			name: "Midnight Synthwave",
			genrePrompt: "80s synthwave, neon, driving bass",
		});
		expect(preset.isActive).toBe(false);
		expect(preset.name).toBe("Midnight Synthwave");
		expect(preset.vocalStyle).toBeNull();
	});

	it("activating a preset deactivates all others", async () => {
		const first = await presetService.createPreset({
			name: "First",
			genrePrompt: "lofi hip hop",
		});
		const second = await presetService.createPreset({
			name: "Second",
			genrePrompt: "dub techno",
		});

		await presetService.activatePreset(first.id);
		expect((await presetService.getActivePreset())?.id).toBe(first.id);

		await presetService.activatePreset(second.id);
		const active = await presetService.getActivePreset();
		expect(active?.id).toBe(second.id);
		expect(
			presetService.listPresets().filter((preset) => preset.isActive),
		).toHaveLength(1);
	});

	it("updates preset fields", async () => {
		const preset = await presetService.createPreset({
			name: "Old Name",
			genrePrompt: "ambient",
		});
		const updated = await presetService.updatePreset(preset.id, {
			name: "New Name",
			vocalStyle: "airy female vocals",
		});
		expect(updated?.name).toBe("New Name");
		expect(updated?.vocalStyle).toBe("airy female vocals");
		expect(updated?.genrePrompt).toBe("ambient");
	});

	it("returns null when updating or activating a missing preset", async () => {
		const active = await presetService.createPreset({
			name: "Still Active",
			genrePrompt: "ambient dub",
		});
		await presetService.activatePreset(active.id);

		expect(await presetService.updatePreset("nope", { name: "x" })).toBeNull();
		expect(await presetService.activatePreset("nope")).toBeNull();
		expect((await presetService.getActivePreset())?.id).toBe(active.id);
	});

	it("deletes presets and clears the active one", async () => {
		const preset = await presetService.createPreset({
			name: "Doomed",
			genrePrompt: "doom jazz",
		});
		await presetService.activatePreset(preset.id);
		expect(await presetService.deletePreset(preset.id)).toBe(true);
		expect(await presetService.deletePreset(preset.id)).toBe(false);
		expect(await presetService.getActivePreset()).toBeNull();
	});

	it("lists presets with active ones first", async () => {
		const first = await presetService.createPreset({
			name: "A",
			genrePrompt: "a",
		});
		const second = await presetService.createPreset({
			name: "B",
			genrePrompt: "b",
		});
		await presetService.activatePreset(second.id);
		const list = presetService.listPresets();
		expect(list[0]?.id).toBe(second.id);
		expect(list.map((preset) => preset.id)).toContain(first.id);
	});

	it.each([
		{
			method: "POST",
			path: "/presets",
			body: { name: "Nope", genrePrompt: "ambient" },
		},
		{
			method: "PATCH",
			path: "/presets/missing",
			body: { name: "Nope" },
		},
		{
			method: "POST",
			path: "/presets/missing/activate",
			body: undefined,
		},
		{
			method: "DELETE",
			path: "/presets/missing",
			body: undefined,
		},
	])(
		"requires a signed-in user for $method $path",
		async ({ method, path, body }) => {
			const response = await radioRoutes.request(path, {
				method,
				headers: body ? { "content-type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "Unauthorized" });
		},
	);

	it("allows an authenticated user to create a preset", async () => {
		vi.mocked(requireUserActor).mockResolvedValue({
			kind: "user",
			userId: "user-1",
		});
		const response = await radioRoutes.request("/presets", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer test-token",
			},
			body: JSON.stringify({
				name: "Authenticated",
				genrePrompt: "ambient dub",
			}),
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({
			name: "Authenticated",
			genrePrompt: "ambient dub",
		});
	});
});
