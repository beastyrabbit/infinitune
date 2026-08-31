import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { db } from "../db/index";
import { radioStationPresets } from "../db/schema";
import { emit } from "../events/event-bus";
import { logger } from "../logger";

export const MAX_STATION_PRESETS = 100;

export class StationPresetLimitError extends Error {
	constructor() {
		super(`A maximum of ${MAX_STATION_PRESETS} station presets is allowed`);
		this.name = "StationPresetLimitError";
	}
}

export interface StationPreset {
	id: string;
	createdAt: number;
	updatedAt: number;
	name: string;
	description: string | null;
	genrePrompt: string;
	vocalStyle: string | null;
	isActive: boolean;
}

function toPreset(row: typeof radioStationPresets.$inferSelect): StationPreset {
	return {
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		name: row.name,
		description: row.description,
		genrePrompt: row.genrePrompt,
		vocalStyle: row.vocalStyle,
		isActive: Boolean(row.isActive),
	};
}

export function listPresets(): StationPreset[] {
	const rows = db
		.select()
		.from(radioStationPresets)
		.orderBy(desc(radioStationPresets.isActive), radioStationPresets.createdAt)
		.limit(MAX_STATION_PRESETS)
		.all();
	return rows.map(toPreset);
}

export function getActivePreset(): StationPreset | null {
	const row = db
		.select()
		.from(radioStationPresets)
		.where(eq(radioStationPresets.isActive, true))
		.limit(1)
		.get();
	return row ? toPreset(row) : null;
}

export interface PresetInput {
	name: string;
	description?: string | null;
	genrePrompt: string;
	vocalStyle?: string | null;
}

export async function createPreset(input: PresetInput): Promise<StationPreset> {
	const now = Date.now();
	const row = db.transaction((tx) => {
		const total =
			tx.select({ value: count() }).from(radioStationPresets).get()?.value ?? 0;
		if (total >= MAX_STATION_PRESETS) throw new StationPresetLimitError();
		return tx
			.insert(radioStationPresets)
			.values({
				id: createId(),
				createdAt: now,
				updatedAt: now,
				name: input.name.trim(),
				description: input.description?.trim() || null,
				genrePrompt: input.genrePrompt.trim(),
				vocalStyle: input.vocalStyle?.trim() || null,
				isActive: false,
			})
			.returning()
			.get();
	});
	logger.info({ presetId: row.id, name: row.name }, "Created station preset");
	emit("radio.presets.changed", { stationId: "global" });
	return toPreset(row);
}

export async function updatePreset(
	presetId: string,
	input: Partial<PresetInput>,
): Promise<StationPreset | null> {
	const updates: Record<string, unknown> = { updatedAt: Date.now() };
	if (input.name !== undefined) updates.name = input.name.trim();
	if (input.description !== undefined)
		updates.description = input.description?.trim() || null;
	if (input.genrePrompt !== undefined)
		updates.genrePrompt = input.genrePrompt.trim();
	if (input.vocalStyle !== undefined)
		updates.vocalStyle = input.vocalStyle?.trim() || null;

	const [row] = await db
		.update(radioStationPresets)
		.set(updates)
		.where(eq(radioStationPresets.id, presetId))
		.returning();
	if (!row) return null;
	emit("radio.presets.changed", { stationId: "global" });
	if (row.isActive) emit("radio.state_changed", { stationId: "global" });
	return toPreset(row);
}

/**
 * Activate a preset as THE current station intent. Exactly one preset is
 * active at a time; switching only changes future generation intent —
 * playback and in-flight generations continue uninterrupted.
 */
export async function activatePreset(
	presetId: string,
): Promise<StationPreset | null> {
	const row = db.transaction((tx) => {
		const target = tx
			.select()
			.from(radioStationPresets)
			.where(eq(radioStationPresets.id, presetId))
			.get();
		if (!target) return null;

		const updatedAt = Date.now();
		tx.update(radioStationPresets)
			.set({ isActive: false, updatedAt })
			.where(
				and(
					ne(radioStationPresets.id, presetId),
					eq(radioStationPresets.isActive, true),
				),
			)
			.run();
		return tx
			.update(radioStationPresets)
			.set({ isActive: true, updatedAt })
			.where(eq(radioStationPresets.id, presetId))
			.returning()
			.get();
	});
	if (!row) return null;
	logger.info({ presetId, name: row.name }, "Activated station preset");
	emit("radio.presets.changed", { stationId: "global" });
	emit("radio.state_changed", { stationId: "global" });
	return toPreset(row);
}

export async function deletePreset(presetId: string): Promise<boolean> {
	const deleted = await db
		.delete(radioStationPresets)
		.where(eq(radioStationPresets.id, presetId))
		.returning({
			id: radioStationPresets.id,
			isActive: radioStationPresets.isActive,
		});
	if (deleted.length === 0) return false;
	emit("radio.presets.changed", { stationId: "global" });
	if (deleted[0].isActive) {
		emit("radio.state_changed", { stationId: "global" });
	}
	return true;
}
