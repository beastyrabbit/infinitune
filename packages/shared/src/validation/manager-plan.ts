import z from "zod";

const EnergyTargetSchema = z.enum(["low", "medium", "high", "extreme"]);
const NoveltyTargetSchema = z.enum(["low", "medium", "high"]);

export const PlaylistManagerPlanSlotV1Schema = z.object({
	slot: z.number().int().min(1).max(12),
	transitionIntent: z.string(),
	topicHint: z.string(),
	captionFocus: z.string(),
	lyricTheme: z.string(),
	energyTarget: EnergyTargetSchema,
});

export const PlaylistManagerPlanV1Schema = z.object({
	version: z.literal(1),
	epoch: z.number().int().min(0),
	startOrderIndex: z.number().optional(),
	windowSize: z.number().int().min(1).max(12),
	strategySummary: z.string(),
	transitionPolicy: z.string(),
	avoidPatterns: z.array(z.string()),
	slots: z.array(PlaylistManagerPlanSlotV1Schema).min(1).max(12),
	updatedAt: z.number(),
});

export const PlaylistManagerPlanSlotV2Schema = z.object({
	slot: z.number().int().min(1).max(12),
	laneId: z.string().min(1),
	preservedAnchors: z.array(z.string()),
	variationMoves: z.array(z.string()),
	sonicFocus: z.string(),
	lyricFocus: z.string(),
	captionFocus: z.string(),
	energyTarget: EnergyTargetSchema,
	noveltyTarget: NoveltyTargetSchema,
	avoidPatterns: z.array(z.string()),
	transitionIntent: z.string().optional(),
	topicHint: z.string().optional(),
	lyricTheme: z.string().optional(),
});

export const PlaylistManagerPlanV2Schema = z.object({
	version: z.literal(2),
	epoch: z.number().int().min(0),
	startOrderIndex: z.number().optional(),
	windowSize: z.number().int().min(1).max(12),
	hardAnchors: z.array(z.string()),
	softAnchors: z.array(z.string()),
	variationBudget: z.enum(["low", "medium", "high"]),
	elasticDimensions: z.array(z.string()),
	forbiddenMoves: z.array(z.string()),
	diversityTargets: z.array(z.string()),
	strategySummary: z.string(),
	transitionPolicy: z.string(),
	topicLanes: z.array(
		z.object({
			id: z.string().min(1),
			summary: z.string(),
			anchors: z.array(z.string()),
		}),
	),
	slots: z.array(PlaylistManagerPlanSlotV2Schema).min(1).max(12),
	criticNotes: z.array(z.string()),
	updatedAt: z.number(),
});

export const PlaylistManagerPlanSchema = z.union([
	PlaylistManagerPlanV2Schema,
	PlaylistManagerPlanV1Schema,
]);

export type PlaylistManagerPlanV1Input = z.infer<
	typeof PlaylistManagerPlanV1Schema
>;
export type PlaylistManagerPlanV2Input = z.infer<
	typeof PlaylistManagerPlanV2Schema
>;

function firstSentence(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	return trimmed.split(/[.!?]\s+/)[0]?.trim() || fallback;
}

export function withLegacySlotFields(
	plan: PlaylistManagerPlanV2Input,
): PlaylistManagerPlanV2Input {
	const lanesById = new Map(plan.topicLanes.map((lane) => [lane.id, lane]));
	return {
		...plan,
		slots: plan.slots.map((slot) => {
			const lane = lanesById.get(slot.laneId);
			return {
				...slot,
				transitionIntent:
					slot.transitionIntent ??
					firstSentence(plan.transitionPolicy, "continue the playlist arc"),
				topicHint:
					slot.topicHint ??
					lane?.summary ??
					slot.lyricFocus ??
					"extend the playlist theme",
				lyricTheme: slot.lyricTheme ?? slot.lyricFocus,
			};
		}),
	};
}

export function normalizePlaylistManagerPlan(
	raw: unknown,
): PlaylistManagerPlanV1Input | PlaylistManagerPlanV2Input | null {
	const parsed = PlaylistManagerPlanSchema.safeParse(raw);
	if (!parsed.success) return null;
	if (parsed.data.version === 2) return withLegacySlotFields(parsed.data);
	return parsed.data;
}
