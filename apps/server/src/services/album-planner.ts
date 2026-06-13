import type { LlmProvider } from "@infinitune/shared/types";
import z from "zod";
import { callLlmObject } from "../external/llm-client";
import type { RadioSourceSettings } from "./cover-source-service";
import * as settingsService from "./settings-service";

// ─── Track mix ──────────────────────────────────────────────────────

// Single source of truth for the track types — reused by the random-fill
// picker and the Zod plan schema so the literals can't drift.
export const RADIO_TRACK_TYPES = ["cover", "new", "cover-of-cover"] as const;
export type RadioTrackType = (typeof RADIO_TRACK_TYPES)[number];

/**
 * Build the per-album track type list from the configured mix
 * (covers + new + cover-of-cover + random fill), normalized to exactly
 * `trackCount` entries (padded with covers / truncated) and shuffled.
 * `rand` is injected for deterministic tests.
 */
export function buildTrackTypeMix(
	settings: RadioSourceSettings,
	trackCount: number,
	rand: () => number = Math.random,
): RadioTrackType[] {
	const types: RadioTrackType[] = [
		...Array<RadioTrackType>(settings.coversPerAlbum).fill("cover"),
		...Array<RadioTrackType>(settings.newPerAlbum).fill("new"),
		...Array<RadioTrackType>(settings.coverOfCoverPerAlbum).fill(
			"cover-of-cover",
		),
	];
	for (let i = 0; i < settings.randomFill; i++) {
		types.push(
			RADIO_TRACK_TYPES[Math.floor(rand() * RADIO_TRACK_TYPES.length)],
		);
	}
	while (types.length < trackCount) types.push("cover");
	types.length = trackCount;

	// Fisher-Yates shuffle so types aren't clustered by position
	for (let i = types.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[types[i], types[j]] = [types[j], types[i]];
	}
	return types;
}

// ─── Plan schema ────────────────────────────────────────────────────

const SearchTargetSchema = z.object({
	title: z.string().min(1),
	artist: z.string().min(1),
});

const TrackPlanSchema = z.object({
	trackNumber: z.number().int().min(1),
	type: z.enum(RADIO_TRACK_TYPES),
	title: z.string().min(1),
	/** Real popular song to cover (cover tracks only) */
	searchTarget: SearchTargetSchema.nullish(),
	/** What the cover changes relative to the original */
	variation: z.enum(["genre", "lyrics", "both"]).nullish(),
	lyrics: z.string().min(1),
	caption: z.string().min(1),
	vocalStyle: z.string().min(1),
	bpm: z.number().min(40).max(220).nullish(),
	keyScale: z.string().nullish(),
	mood: z.string().nullish(),
	energy: z.enum(["low", "medium", "high"]).nullish(),
});

export const AlbumPlanSchema = z.object({
	album: z.object({
		targetGenre: z.string().min(1),
		era: z.string().min(1),
		vibe: z.string().min(1),
		bandName: z.string().min(1),
		albumTitle: z.string().min(1),
	}),
	tracks: z.array(TrackPlanSchema).min(1),
});

export type AlbumPlan = z.infer<typeof AlbumPlanSchema>;
export type TrackPlan = z.infer<typeof TrackPlanSchema>;

/**
 * Align the LLM's tracks with the requested type list: index by trackNumber,
 * force each slot's type back to what was requested, and drop search targets
 * from non-cover slots. Slots the LLM skipped come back as undefined so the
 * caller can fill them deterministically.
 */
export function normalizeAlbumPlanTracks(
	plan: AlbumPlan,
	trackTypes: RadioTrackType[],
): Array<TrackPlan | undefined> {
	const byNumber = new Map<number, TrackPlan>();
	for (const track of plan.tracks) {
		if (!byNumber.has(track.trackNumber)) {
			byNumber.set(track.trackNumber, track);
		}
	}
	return trackTypes.map((type, index) => {
		const track = byNumber.get(index + 1);
		if (!track) return undefined;
		const isCover = type === "cover" || type === "cover-of-cover";
		return {
			...track,
			type,
			searchTarget: isCover ? track.searchTarget : null,
			variation: isCover ? (track.variation ?? "both") : null,
		};
	});
}

// ─── LLM planner call ───────────────────────────────────────────────

export interface PlanAlbumInput {
	theme: string;
	kind: string;
	trackTypes: RadioTrackType[];
	targetTrackPrompt?: string;
	recentAlbums: Array<{
		title: string;
		bandName: string | null;
		theme: string;
	}>;
	recentCoverTargets: string[];
	signal?: AbortSignal;
}

function buildPlannerPrompt(input: PlanAlbumInput): string {
	const slotLines = input.trackTypes
		.map((type, index) => `  track ${index + 1}: ${type}`)
		.join("\n");
	return [
		`Design one radio album of exactly ${input.trackTypes.length} three-minute tracks.`,
		`Album theme seed: ${input.theme}`,
		input.targetTrackPrompt
			? `One track should honor this listener request: ${input.targetTrackPrompt}`
			: "",
		"",
		"Slot plan (the type of every track is fixed — do not change it):",
		slotLines,
		"",
		"Rules:",
		"- Pick ONE cohesive target genre + era + vibe for the whole album; every track is produced in that style.",
		"- Invent a band name and album title that fit. Avoid these recent albums: " +
			(input.recentAlbums
				.map((a) => `"${a.title}" by ${a.bandName ?? "?"}`)
				.join(", ") || "none"),
		'- For each "cover" track: name a REAL, well-known popular song (released 1980s to today) that suits the album\'s target genre and era as searchTarget {title, artist}. Do not invent songs. Avoid these already-covered songs: ' +
			(input.recentCoverTargets.join(", ") || "none"),
		'- For each cover also choose variation: "genre" (the song is restyled into the album genre, lyrics stay true to the original\'s themes and hook structure), "lyrics" (fresh original lyrics over the source\'s structure), or "both".',
		'- Write full lyrics for EVERY track ([Verse]/[Chorus] sections). For variation "genre", evoke the original\'s themes and hooks in your own words; for "lyrics"/"both", write fresh original lyrics.',
		'- "cover-of-cover" tracks reinterpret one of the station\'s own earlier covers: fresh lyrics + caption in the album genre; no searchTarget needed.',
		"- caption: a concise production brief for the music model (genre, instrumentation, vocal treatment) consistent with the album style.",
		"- vocalStyle: vary vocal casting across tracks but keep it plausible for one band.",
		"Return tracks for ALL slots, numbered 1..N matching the slot plan.",
	]
		.filter(Boolean)
		.join("\n");
}

export async function planAlbumWithLlm(
	input: PlanAlbumInput,
): Promise<AlbumPlan> {
	const settings = await settingsService.getAll();
	const provider = (settings.textProvider || "openai-codex") as LlmProvider;
	const model = settings.textModel || "";
	return callLlmObject({
		provider,
		model,
		system:
			"You are the Infinitune radio album planner. You design cohesive cover-first radio albums. Return only valid JSON matching the requested schema.",
		prompt: buildPlannerPrompt(input),
		schema: AlbumPlanSchema,
		schemaName: "RadioAlbumPlan",
		temperature: 0.8,
		signal: input.signal,
	});
}
