import type { PlaylistManagerPlanSlot } from "@infinitune/shared/types";
import { normalizePlaylistManagerPlan } from "@infinitune/shared/validation/manager-plan";
import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "../../db/index";
import { playlists, songs } from "../../db/schema";
import * as playlistService from "../../services/playlist-service";
import { parseJsonField, playlistToWire, songToWire } from "../../wire";
import {
	type AgentId,
	assertAgentToolAllowed,
	isAgentToolAllowed,
} from "../agent-registry";

function jsonResult(details: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
	};
}

function clampLimit(value: unknown, fallback: number, max: number): number {
	const parsed = typeof value === "number" ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(parsed, max));
}

async function playlistOrThrow(playlistId: string) {
	const [playlist] = await db
		.select()
		.from(playlists)
		.where(eq(playlists.id, playlistId));
	if (!playlist) throw new Error(`Playlist not found: ${playlistId}`);
	return playlist;
}

function collectSongTopics(song: typeof songs.$inferSelect): string[] {
	const values = [
		song.genre,
		song.subGenre,
		song.mood,
		song.energy,
		song.vocalStyle,
		song.description,
		...(parseJsonField<string[]>(song.themes) ?? []),
		...(parseJsonField<string[]>(song.tags) ?? []),
	];
	return values
		.flatMap((value) => (value ? [value.trim()] : []))
		.filter(Boolean)
		.slice(0, 12);
}

export async function getPlaylistOverviewData(playlistId: string) {
	const playlist = await playlistOrThrow(playlistId);
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId));
	const currentPosition = playlist.currentOrderIndex ?? 0;
	return {
		playlist: {
			id: playlist.id,
			name: playlist.name,
			prompt: playlist.prompt,
			status: playlist.status,
			epoch: playlist.promptEpoch ?? 0,
			mode: playlist.mode,
			language: playlist.lyricsLanguage,
			currentPosition,
			playlistKey: playlist.playlistKey,
			description: playlist.description,
			managerEpoch: playlist.managerEpoch,
			managerPlan: normalizePlaylistManagerPlan(
				parseJsonField(playlist.managerPlan) ?? null,
			),
		},
		counts: {
			total: rows.length,
			ready: rows.filter((song) => song.status === "ready").length,
			played: rows.filter((song) => song.status === "played").length,
			pending: rows.filter((song) => song.status === "pending").length,
			ratedUp: rows.filter((song) => song.userRating === "up").length,
			ratedDown: rows.filter((song) => song.userRating === "down").length,
		},
	};
}

export async function getRecentSongsData(playlistId: string, limit = 12) {
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))
		.orderBy(desc(songs.orderIndex))
		.limit(Math.max(1, Math.min(limit, 40)));
	return rows.map(songToWire);
}

export async function getTopicHistoryData(playlistId: string) {
	const playlist = await playlistOrThrow(playlistId);
	const rows = await db
		.select()
		.from(songs)
		.where(eq(songs.playlistId, playlistId))
		.orderBy(desc(songs.orderIndex));
	const topicCounts = new Map<string, number>();
	for (const song of rows) {
		for (const topic of collectSongTopics(song)) {
			const key = topic.toLowerCase();
			topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1);
		}
	}
	const managerPlan = normalizePlaylistManagerPlan(
		parseJsonField(playlist.managerPlan) ?? null,
	);
	return {
		usedTopicLanes: [...topicCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 30)
			.map(([topic, count]) => ({ topic, count })),
		managerTopicLanes:
			managerPlan?.version === 2
				? managerPlan.topicLanes
				: (managerPlan?.slots ?? []).map((slot: PlaylistManagerPlanSlot) => ({
						id: `legacy-${slot.slot}`,
						summary: "topicHint" in slot ? slot.topicHint : "",
						anchors: [],
					})),
	};
}

export function createPlaylistContextTools(agentId: AgentId): ToolDefinition[] {
	const tools: ToolDefinition[] = [
		{
			name: "get_playlist_overview",
			label: "Get Playlist Overview",
			description:
				"Return playlist prompt, status, epoch, mode, language, constraints, current position, counts, and manager plan.",
			promptSnippet: "Use playlist overview for current ask and epoch.",
			parameters: Type.Object({ playlistId: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "get_playlist_overview");
				const p = params as { playlistId: string };
				return jsonResult(await getPlaylistOverviewData(p.playlistId));
			},
		},
		{
			name: "search_playlist_songs",
			label: "Search Playlist Songs",
			description:
				"Search playlist song history by text, status, rating, and epoch.",
			promptSnippet:
				"Search song history before claiming novelty or repetition.",
			parameters: Type.Object({
				playlistId: Type.String(),
				query: Type.Optional(Type.String()),
				status: Type.Optional(Type.String()),
				rating: Type.Optional(Type.String()),
				epoch: Type.Optional(Type.Number()),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "search_playlist_songs");
				const p = params as {
					playlistId: string;
					query?: string;
					status?: string;
					rating?: string;
					epoch?: number;
					limit?: number;
				};
				const limit = clampLimit(p.limit, 20, 50);
				const predicates = [eq(songs.playlistId, p.playlistId)];
				if (p.status) predicates.push(eq(songs.status, p.status));
				if (p.rating) predicates.push(eq(songs.userRating, p.rating));
				if (typeof p.epoch === "number") {
					predicates.push(eq(songs.promptEpoch, p.epoch));
				}
				if (p.query?.trim()) {
					const pattern = `%${p.query.trim()}%`;
					predicates.push(like(songs.description, pattern));
				}
				const rows = await db
					.select()
					.from(songs)
					.where(and(...predicates))
					.orderBy(desc(songs.orderIndex))
					.limit(limit);
				return jsonResult({ songs: rows.map(songToWire) });
			},
		},
		{
			name: "get_recent_songs",
			label: "Get Recent Songs",
			description:
				"Return recent generated songs. This replaces fixed last-5-song context.",
			promptSnippet:
				"Use configurable recent song context, not hardcoded last five.",
			parameters: Type.Object({
				playlistId: Type.String(),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "get_recent_songs");
				const p = params as { playlistId: string; limit?: number };
				return jsonResult({
					songs: await getRecentSongsData(
						p.playlistId,
						clampLimit(p.limit, 12, 40),
					),
				});
			},
		},
		{
			name: "get_rated_songs",
			label: "Get Rated Songs",
			description:
				"Return liked and disliked songs, including persona extracts when available.",
			promptSnippet: "Use rated songs as taste feedback.",
			parameters: Type.Object({
				playlistId: Type.String(),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "get_rated_songs");
				const p = params as { playlistId: string; limit?: number };
				const rows = await db
					.select()
					.from(songs)
					.where(eq(songs.playlistId, p.playlistId))
					.orderBy(desc(songs.orderIndex))
					.limit(clampLimit(p.limit, 20, 50));
				return jsonResult({
					songs: rows
						.filter(
							(song) => song.userRating === "up" || song.userRating === "down",
						)
						.map(songToWire),
				});
			},
		},
		{
			name: "get_topic_history",
			label: "Get Topic History",
			description:
				"Derive used topic lanes from song themes, tags, descriptions, personas, and prior manager plans.",
			promptSnippet: "Use topic history to avoid stale repetition.",
			parameters: Type.Object({ playlistId: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "get_topic_history");
				const p = params as { playlistId: string };
				return jsonResult(await getTopicHistoryData(p.playlistId));
			},
		},
		{
			name: "get_generation_constraints",
			label: "Get Generation Constraints",
			description:
				"Return language lock, BPM/key/time/duration, ACE settings, and prompt profile/mode constraints.",
			promptSnippet:
				"Use generation constraints before writing production or song specs.",
			parameters: Type.Object({ playlistId: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "get_generation_constraints");
				const p = params as { playlistId: string };
				const playlist = await playlistOrThrow(p.playlistId);
				return jsonResult({
					lyricsLanguage: playlist.lyricsLanguage,
					targetBpm: playlist.targetBpm,
					targetKey: playlist.targetKey,
					timeSignature: playlist.timeSignature,
					audioDuration: playlist.audioDuration,
					inferenceSteps: playlist.inferenceSteps,
					lmTemperature: playlist.lmTemperature,
					lmCfgScale: playlist.lmCfgScale,
					inferMethod: playlist.inferMethod,
					aceModel: playlist.aceModel,
					aceDcwEnabled: playlist.aceDcwEnabled,
					aceDcwMode: playlist.aceDcwMode,
					aceDcwScaler: playlist.aceDcwScaler,
					aceDcwHighScaler: playlist.aceDcwHighScaler,
					aceDcwWavelet: playlist.aceDcwWavelet,
					aceThinking: playlist.aceThinking,
					aceAutoDuration: playlist.aceAutoDuration,
				});
			},
		},
		{
			name: "save_playlist_plan",
			label: "Save Playlist Plan",
			description:
				"Validate expected epoch and save a playlist manager plan. Only the playlist director may use this.",
			promptSnippet: "Save only final director-approved V2 playlist plans.",
			parameters: Type.Object({
				playlistId: Type.String(),
				expectedEpoch: Type.Number(),
				managerBrief: Type.String(),
				managerPlan: Type.Any(),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "save_playlist_plan");
				const p = params as {
					playlistId: string;
					expectedEpoch: number;
					managerBrief: string;
					managerPlan: unknown;
				};
				const playlist = playlistToWire(await playlistOrThrow(p.playlistId));
				if ((playlist.promptEpoch ?? 0) !== p.expectedEpoch) {
					throw new Error(
						`Epoch mismatch: expected ${p.expectedEpoch}, current ${playlist.promptEpoch ?? 0}`,
					);
				}
				const normalized = normalizePlaylistManagerPlan(p.managerPlan);
				if (!normalized) throw new Error("Invalid playlist manager plan");
				await playlistService.updateManagerBrief(p.playlistId, {
					managerBrief: p.managerBrief,
					managerPlan: JSON.stringify(normalized),
					managerEpoch: p.expectedEpoch,
				});
				return jsonResult({ ok: true, managerPlan: normalized });
			},
		},
	];

	return tools.filter((tool) => isAgentToolAllowed(agentId, tool.name));
}
