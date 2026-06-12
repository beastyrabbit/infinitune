import type { LlmProvider } from "@infinitune/shared/types";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { sqlite } from "../db/index";
import { emit } from "../events/event-bus";
import { callLlmObject } from "../external/llm-client";
import { logger } from "../logger";
import {
	getRadioAnalytics,
	RADIO_STATION_ID,
} from "./album-generation-service";
import * as settingsService from "./settings-service";

export interface RadioScheduleItem {
	slotIndex: number;
	songId: string;
	reason: string;
	score: number;
	locked: boolean;
	isRequest: boolean;
	title: string | null;
	artistName: string | null;
	albumId: string | null;
	albumTitle: string | null;
	albumTrackNumber: number | null;
	genre: string | null;
	vocalStyle: string | null;
	audioDuration: number | null;
	audioUrl: string | null;
}

interface Candidate {
	id: string;
	title: string | null;
	artistName: string | null;
	albumId: string;
	albumTitle: string | null;
	albumTrackNumber: number | null;
	genre: string | null;
	vocalStyle: string | null;
	likeCount: number;
	dislikeCount: number;
	skipCount: number;
	radioPlayCount: number;
	lastRadioPlayedAt: number | null;
	requestId: string | null;
	requestStatus: string | null;
	audioUrl: string | null;
	audioDuration: number | null;
}

interface RecentPlay {
	songId: string;
	albumId: string | null;
	genre: string | null;
	vocalStyle: string | null;
}

const MixerPlanSchema = z.object({
	plan: z
		.array(
			z.object({
				songId: z.string(),
				transitionReason: z.string(),
				freshnessReason: z.string(),
				requestMarker: z.boolean(),
				fallbackScore: z.number(),
			}),
		)
		.max(10),
});

let llmPlannerTimer: ReturnType<typeof setTimeout> | null = null;
let llmPlannerInFlight = false;

function getCurrentSongId(): string | null {
	const row = sqlite
		.prepare(
			"SELECT current_song_id as currentSongId FROM radio_stations WHERE id = ?",
		)
		.get(RADIO_STATION_ID) as { currentSongId: string | null } | undefined;
	return row?.currentSongId ?? null;
}

function getRecentPlays(): RecentPlay[] {
	return sqlite
		.prepare(
			`
				SELECT
					s.id as songId,
					s.album_id as albumId,
					s.genre as genre,
					s.vocal_style as vocalStyle
				FROM radio_plays rp
				JOIN songs s ON s.id = rp.song_id
				ORDER BY rp.started_at DESC
				LIMIT 30
			`,
		)
		.all() as RecentPlay[];
}

function getCandidates(): Candidate[] {
	return sqlite
		.prepare(
			`
				SELECT
					s.id,
					s.title,
					s.artist_name as artistName,
					s.album_id as albumId,
					a.title as albumTitle,
					s.album_track_number as albumTrackNumber,
					s.genre,
					s.vocal_style as vocalStyle,
					COALESCE(s.like_count, 0) as likeCount,
					COALESCE(s.dislike_count, 0) as dislikeCount,
					COALESCE(s.skip_count, 0) as skipCount,
					COALESCE(s.radio_play_count, 0) as radioPlayCount,
					s.last_radio_played_at as lastRadioPlayedAt,
					s.request_id as requestId,
					rr.status as requestStatus,
					s.audio_url as audioUrl,
					s.audio_duration as audioDuration
				FROM songs s
				JOIN albums a ON a.id = s.album_id
				LEFT JOIN radio_requests rr ON rr.id = s.request_id
				WHERE s.radio_eligible = 1
					AND s.album_id IS NOT NULL
					AND s.status = 'ready'
				ORDER BY s.radio_play_count ASC, s.created_at ASC
			`,
		)
		.all() as Candidate[];
}

function scoreCandidate(
	candidate: Candidate,
	selected: Candidate[],
	recent: RecentPlay[],
	currentSongId: string | null,
) {
	let score = 100;
	const reason: string[] = [];

	if (candidate.id === currentSongId)
		return { score: -Infinity, reason: "current" };

	if (candidate.radioPlayCount === 0) {
		score += 80;
		reason.push("new song");
	} else {
		score -= Math.min(45, candidate.radioPlayCount * 8);
		reason.push(`${candidate.radioPlayCount} prior plays`);
	}

	score += Math.min(35, candidate.likeCount * 6);
	score -= Math.min(30, candidate.dislikeCount * 5);
	score -= Math.min(35, candidate.skipCount * 7);
	if (candidate.likeCount > 0) reason.push("liked signal");
	if (candidate.dislikeCount > 0 || candidate.skipCount > 0) {
		reason.push("tempered by feedback");
	}

	if (candidate.requestId && candidate.requestStatus !== "played") {
		score += 90;
		reason.push("ready request");
	}

	const lastFive = recent.slice(0, 5);
	if (lastFive.some((play) => play.albumId === candidate.albumId)) {
		score -= 45;
		reason.push("album spacing");
	}
	if (lastFive.some((play) => play.genre === candidate.genre)) score -= 18;
	if (lastFive.some((play) => play.vocalStyle === candidate.vocalStyle))
		score -= 16;

	for (const chosen of selected.slice(-3)) {
		if (chosen.albumId === candidate.albumId) score -= 55;
		if (chosen.genre === candidate.genre) score -= 20;
		if (chosen.vocalStyle === candidate.vocalStyle) score -= 16;
	}

	if (candidate.lastRadioPlayedAt) {
		const ageHours = (Date.now() - candidate.lastRadioPlayedAt) / 3_600_000;
		score += Math.min(24, ageHours / 2);
	}

	return {
		score,
		reason: reason.length > 0 ? reason.join(", ") : "balanced fallback",
	};
}

function buildPlan(candidates: Candidate[], currentSongId: string | null) {
	const recent = getRecentPlays();
	const selected: Array<Candidate & { reason: string; score: number }> = [];
	const remaining = candidates.filter(
		(candidate) => candidate.id !== currentSongId,
	);
	const initialAlbumCount = new Set(
		remaining.map((candidate) => candidate.albumId),
	).size;
	const planLength = Math.min(10, remaining.length);
	const maxPerAlbum =
		initialAlbumCount <= 1
			? planLength
			: Math.max(1, Math.ceil(planLength / initialAlbumCount));

	while (selected.length < 10 && remaining.length > 0) {
		const albumUseCounts = new Map<string, number>();
		for (const item of selected) {
			albumUseCounts.set(
				item.albumId,
				(albumUseCounts.get(item.albumId) ?? 0) + 1,
			);
		}
		const lastAlbumId = selected[selected.length - 1]?.albumId;
		const albumsStillAvailable = new Set(
			remaining.map((candidate) => candidate.albumId),
		);
		const hasAlbumBelowQuota = remaining.some(
			(candidate) => (albumUseCounts.get(candidate.albumId) ?? 0) < maxPerAlbum,
		);
		const allowedByAlbumSpacing = (candidate: Candidate) => {
			const hasDifferentAlbum =
				albumsStillAvailable.size > 1 &&
				remaining.some((item) => item.albumId !== candidate.albumId);
			if (hasDifferentAlbum && candidate.albumId === lastAlbumId) return false;
			if (
				hasAlbumBelowQuota &&
				(albumUseCounts.get(candidate.albumId) ?? 0) >= maxPerAlbum
			) {
				return false;
			}
			return true;
		};
		const pickBestIndex = (strict: boolean) => {
			let bestIndex = -1;
			let best: {
				score: number;
				reason: string;
			} | null = null;
			for (let i = 0; i < remaining.length; i++) {
				if (strict && !allowedByAlbumSpacing(remaining[i])) continue;
				const scored = scoreCandidate(
					remaining[i],
					selected,
					recent,
					currentSongId,
				);
				if (!best || scored.score > best.score) {
					best = scored;
					bestIndex = i;
				}
			}
			return { bestIndex, best };
		};
		let { bestIndex, best } = pickBestIndex(true);
		if (bestIndex < 0 || !best) {
			({ bestIndex, best } = pickBestIndex(false));
		}
		if (bestIndex < 0 || !best) break;
		const [picked] = remaining.splice(bestIndex, 1);
		const reason =
			picked.albumId !== lastAlbumId && selected.length > 0
				? `${best.reason}, album rotation`
				: best.reason;
		selected.push({ ...picked, reason, score: best.score });
	}

	return selected;
}

type PlannedCandidate = Candidate & {
	reason: string;
	score: number;
	isRequest?: boolean;
};

function writeSchedule(plan: PlannedCandidate[], reason: string) {
	const now = Date.now();
	const scheduleVersion = sqlite.transaction(() => {
		const station = sqlite
			.prepare(
				"SELECT schedule_version as scheduleVersion FROM radio_stations WHERE id = ?",
			)
			.get(RADIO_STATION_ID) as { scheduleVersion: number } | undefined;
		const nextVersion = (station?.scheduleVersion ?? 0) + 1;
		sqlite
			.prepare("DELETE FROM radio_schedule WHERE station_id = ?")
			.run(RADIO_STATION_ID);
		const insert = sqlite.prepare(
			`
				INSERT INTO radio_schedule (
					id,
					created_at,
					station_id,
					slot_index,
					song_id,
					reason,
					score,
					locked,
					is_request,
					schedule_version
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
		);
		for (let slotIndex = 0; slotIndex < plan.length; slotIndex++) {
			const item = plan[slotIndex];
			insert.run(
				createId(),
				now,
				RADIO_STATION_ID,
				slotIndex,
				item.id,
				`${reason}: ${item.reason}`,
				item.score,
				0,
				item.isRequest || item.requestId ? 1 : 0,
				nextVersion,
			);
		}
		sqlite
			.prepare(
				"UPDATE radio_stations SET schedule_version = ?, updated_at = ? WHERE id = ?",
			)
			.run(nextVersion, now, RADIO_STATION_ID);
		return nextVersion;
	})();

	emit("radio.schedule_changed", {
		stationId: RADIO_STATION_ID,
		scheduleVersion,
	});
	return getScheduleSnapshot();
}

function buildPlannerPrompt(input: {
	currentSongId: string | null;
	recent: RecentPlay[];
	currentSchedule: RadioScheduleItem[];
	candidates: Candidate[];
	fallbackPlan: PlannedCandidate[];
}) {
	return [
		"Select the next 10 songs for the single global Infinitune radio station.",
		"Use only candidate song ids from the provided candidate list.",
		"Policy: prefer new songs, avoid tight album/genre/vocal repeats, use likes/dislikes statistically, allow rare disliked replays, prioritize ready requests near-future.",
		"Hard rule: never put two songs from the same album next to each other while another ready album is available.",
		"Hard rule: spread album representation across the first 10; do not dump a full album into the airing plan.",
		"Existing legacy songs are already excluded from candidates.",
		"Return an ordered plan with transition and freshness reasons. If fewer than 10 candidates are available, return all usable candidates.",
		JSON.stringify(
			{
				currentSongId: input.currentSongId,
				last30Plays: input.recent,
				currentNext10: input.currentSchedule.map((item) => ({
					slotIndex: item.slotIndex,
					songId: item.songId,
					albumId: item.albumId,
					genre: item.genre,
					vocalStyle: item.vocalStyle,
					reason: item.reason,
				})),
				readyRadioSongs: input.candidates.slice(0, 80).map((candidate) => ({
					songId: candidate.id,
					title: candidate.title,
					albumId: candidate.albumId,
					albumTitle: candidate.albumTitle,
					albumTrackNumber: candidate.albumTrackNumber,
					genre: candidate.genre,
					vocalStyle: candidate.vocalStyle,
					likeCount: candidate.likeCount,
					dislikeCount: candidate.dislikeCount,
					skipCount: candidate.skipCount,
					radioPlayCount: candidate.radioPlayCount,
					lastRadioPlayedAt: candidate.lastRadioPlayedAt,
					requestId: candidate.requestId,
					requestStatus: candidate.requestStatus,
				})),
				fallbackPlan: input.fallbackPlan.map((item, index) => ({
					slotIndex: index,
					songId: item.id,
					score: item.score,
					reason: item.reason,
				})),
				libraryAnalytics: getRadioAnalytics(),
			},
			null,
			2,
		),
	].join("\n\n");
}

async function buildLlmPlan(
	candidates: Candidate[],
	currentSongId: string | null,
	fallbackPlan: PlannedCandidate[],
): Promise<PlannedCandidate[]> {
	const settings = await settingsService.getAll();
	const provider = (settings.textProvider || "openai-codex") as LlmProvider;
	const model = settings.textModel || "";
	const recent = getRecentPlays();
	const currentSchedule = getScheduleSnapshot();
	const output = await callLlmObject({
		provider,
		model,
		system:
			"You are the Infinitune radio mixer agent. Return only valid JSON matching the requested schema. Never invent song ids.",
		prompt: buildPlannerPrompt({
			currentSongId,
			recent,
			currentSchedule,
			candidates,
			fallbackPlan,
		}),
		schema: MixerPlanSchema,
		schemaName: "RadioMixerPlan",
		temperature: 0.35,
	});

	const byId = new Map(
		candidates.map((candidate) => [candidate.id, candidate]),
	);
	const used = new Set<string>();
	const selected: PlannedCandidate[] = [];
	for (const item of output.plan) {
		const candidate = byId.get(item.songId);
		if (!candidate || item.songId === currentSongId || used.has(item.songId)) {
			continue;
		}
		used.add(item.songId);
		selected.push({
			...candidate,
			reason: `${item.transitionReason}; ${item.freshnessReason}`,
			score: item.fallbackScore,
			isRequest: item.requestMarker,
		});
		if (selected.length >= 10) break;
	}

	for (const item of fallbackPlan) {
		if (selected.length >= 10) break;
		if (used.has(item.id)) continue;
		used.add(item.id);
		selected.push(item);
	}

	return selected;
}

function scheduleLlmRefinement(reason: string) {
	if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
	if (llmPlannerInFlight) return;
	if (llmPlannerTimer) clearTimeout(llmPlannerTimer);
	llmPlannerTimer = setTimeout(() => {
		llmPlannerTimer = null;
		void applyLlmSchedule(reason);
	}, 300);
}

async function applyLlmSchedule(reason: string) {
	if (llmPlannerInFlight) return;
	llmPlannerInFlight = true;
	try {
		const currentSongId = getCurrentSongId();
		const candidates = getCandidates();
		if (candidates.length === 0) return;
		const fallbackPlan = buildPlan(candidates, currentSongId);
		const llmPlan = await buildLlmPlan(candidates, currentSongId, fallbackPlan);
		writeSchedule(llmPlan, `${reason}-llm`);
	} catch (err) {
		logger.warn(
			{ err, reason },
			"Radio mixer LLM planner failed; fallback kept",
		);
	} finally {
		llmPlannerInFlight = false;
	}
}

export function recomputeRadioSchedule(reason = "mixer-fallback") {
	const currentSongId = getCurrentSongId();
	const candidates = getCandidates();
	const plan = buildPlan(candidates, currentSongId);
	const snapshot = writeSchedule(plan, reason);
	scheduleLlmRefinement(reason);
	return snapshot;
}

export function getScheduleSnapshot(): RadioScheduleItem[] {
	type RadioScheduleRow = Omit<RadioScheduleItem, "locked" | "isRequest"> & {
		locked: number;
		isRequest: number;
	};
	return (
		sqlite
			.prepare(
				`
				SELECT
					rs.slot_index as slotIndex,
					rs.song_id as songId,
					rs.reason,
					rs.score,
					rs.locked,
					rs.is_request as isRequest,
					s.title,
					s.artist_name as artistName,
					s.album_id as albumId,
					a.title as albumTitle,
					s.album_track_number as albumTrackNumber,
					s.genre,
					s.vocal_style as vocalStyle,
					s.audio_duration as audioDuration,
					s.audio_url as audioUrl
				FROM radio_schedule rs
				JOIN songs s ON s.id = rs.song_id
				LEFT JOIN albums a ON a.id = s.album_id
				WHERE rs.station_id = ?
				ORDER BY rs.slot_index ASC
			`,
			)
			.all(RADIO_STATION_ID) as RadioScheduleRow[]
	).map((item) => {
		return {
			...item,
			locked: Boolean(item.locked),
			isRequest: Boolean(item.isRequest),
		};
	});
}

export function pickNextScheduledSongId(): string | null {
	let schedule = getScheduleSnapshot();
	if (schedule.length === 0) {
		schedule = recomputeRadioSchedule("empty-schedule");
	}
	return schedule[0]?.songId ?? null;
}
