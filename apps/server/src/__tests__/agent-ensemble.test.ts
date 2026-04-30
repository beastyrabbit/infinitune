import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, setupTestDb, teardownTestDb } from "./test-db";

const emittedEvents: Array<{ event: string; data: unknown }> = [];

vi.mock("../db/index", () => ({
	get db() {
		return getTestDb();
	},
}));

vi.mock("../events/event-bus", () => ({
	emit: (event: string, data: unknown) => {
		emittedEvents.push({ event, data });
	},
	on: vi.fn(),
	removeAllListeners: vi.fn(),
}));

vi.mock("../external/pi-runtime", () => ({
	promptInfinituneAgent: vi.fn().mockResolvedValue("Director reply"),
}));

import {
	normalizeLlmProvider,
	resolveTextLlmProfile,
} from "@infinitune/shared/text-llm-profile";
import {
	normalizePlaylistManagerPlan,
	withLegacySlotFields,
} from "@infinitune/shared/validation/manager-plan";
import {
	type AgentId,
	BUILTIN_PI_TOOL_NAMES,
	getAgentSpec,
	getPiToolAllowlist,
	isAgentToolAllowed,
	listAgentSpecs,
} from "../agents/agent-registry";
import {
	listPendingRequiredQuestions,
	postChannelMessage,
	readChannelMessages,
} from "../agents/channel-store";
import {
	deleteMemory,
	getMemory,
	updateMemory,
	writeMemory,
} from "../agents/memory-store";
import {
	answerDirectorQuestion,
	postHumanChat,
} from "../agents/playlist-director-service";
import {
	getRecentSongsData,
	getTopicHistoryData,
} from "../agents/tools/playlist-context-tools";
import { playlists, songs } from "../db/schema";
import * as playlistService from "../services/playlist-service";

const AGENTS: AgentId[] = [
	"playlist-director",
	"topic-scout",
	"continuity-critic",
	"production-designer",
	"lyric-dramatist",
	"song-spec-writer",
	"persona-analyst",
	"memory-curator",
	"album-curator",
];

describe("agent ensemble", () => {
	beforeEach(() => {
		setupTestDb();
		emittedEvents.length = 0;
	});

	afterEach(() => {
		teardownTestDb();
	});

	it("declares every Infinitune role with Pi provider defaults", () => {
		expect(
			listAgentSpecs()
				.map((spec) => spec.id)
				.sort(),
		).toEqual([...AGENTS].sort());
		for (const spec of listAgentSpecs()) {
			expect(spec.modelPolicy.primary).toEqual({
				provider: "openai-codex",
				model: "gpt-5.2",
			});
			expect(spec.modelPolicy.fallback).toEqual({
				provider: "anthropic",
				model: "claude-sonnet-4-6",
			});
			expect(spec.outputSchema).toHaveProperty("type", "json-object");
		}
		expect(getAgentSpec("playlist-director").modelPolicy.thinkingLevel).toBe(
			"high",
		);
		expect(getAgentSpec("continuity-critic").modelPolicy.thinkingLevel).toBe(
			"high",
		);
		expect(getAgentSpec("lyric-dramatist").modelPolicy.thinkingLevel).toBe(
			"low",
		);
	});

	it("keeps builtin Pi shell/file/edit/write tools out of allowlists", () => {
		for (const agentId of AGENTS) {
			const allowlist = getPiToolAllowlist(agentId);
			for (const builtin of BUILTIN_PI_TOOL_NAMES) {
				expect(allowlist).not.toContain(builtin);
			}
		}
	});

	it("allows channel collaboration but reserves decisions for the director", () => {
		for (const agentId of AGENTS) {
			expect(isAgentToolAllowed(agentId, "channel_read")).toBe(true);
			expect(isAgentToolAllowed(agentId, "channel_post")).toBe(true);
		}
		expect(isAgentToolAllowed("playlist-director", "channel_decide")).toBe(
			true,
		);
		for (const agentId of AGENTS.filter((id) => id !== "playlist-director")) {
			expect(isAgentToolAllowed(agentId, "channel_decide")).toBe(false);
		}
	});

	it("reserves memory writes/deletes for director and memory curator", () => {
		expect(getAgentSpec("playlist-director").canWriteMemory).toBe(true);
		expect(getAgentSpec("memory-curator").canWriteMemory).toBe(true);
		for (const agentId of AGENTS) {
			const canWrite =
				agentId === "playlist-director" || agentId === "memory-curator";
			expect(isAgentToolAllowed(agentId, "memory_write")).toBe(canWrite);
			expect(isAgentToolAllowed(agentId, "memory_delete")).toBe(canWrite);
		}
	});

	it("returns human-edited memory as plain current JSON without provenance", async () => {
		const playlist = await playlistService.create({
			name: "Memory",
			prompt: "synth pop",
			llmProvider: "ollama",
			llmModel: "",
		});
		const entry = await writeMemory({
			scope: "playlist",
			playlistId: playlist.id,
			kind: "taste",
			title: "Texture",
			content: { likes: ["glass pads"] },
			confidence: 0.6,
			importance: 0.7,
		});
		await updateMemory(entry.id, {
			content: { likes: ["glass pads", "dry drums"] },
			confidence: 0.9,
		});
		const edited = await getMemory(entry.id);

		expect(edited?.content).toEqual({
			likes: ["glass pads", "dry drums"],
		});
		expect(Object.keys(edited ?? {})).not.toContain("editedBy");
		expect(Object.keys(edited ?? {})).not.toContain("humanEditedBy");

		await deleteMemory(entry.id);
		expect((await getMemory(entry.id))?.deletedAt).toEqual(expect.any(Number));
	});

	it("uses configurable recent-song and derived topic history context", async () => {
		const playlist = await playlistService.create({
			name: "Topic History",
			prompt: "cosmic disco",
			llmProvider: "openrouter",
			llmModel: "",
		});
		const db = getTestDb();
		for (let index = 1; index <= 13; index++) {
			await db.insert(songs).values({
				playlistId: playlist.id,
				orderIndex: index,
				status: "ready",
				title: `Song ${index}`,
				artistName: `Artist ${index}`,
				genre: "Disco",
				subGenre: index % 2 === 0 ? "Cosmic" : "Italo",
				description: index % 2 === 0 ? "mirrorball orbit" : "neon highway",
				themes: JSON.stringify(["space", index % 2 === 0 ? "orbit" : "drive"]),
				tags: JSON.stringify(["dance"]),
			});
		}

		const recent = await getRecentSongsData(playlist.id);
		expect(recent).toHaveLength(12);
		expect(recent[0].title).toBe("Song 13");

		const topicHistory = await getTopicHistoryData(playlist.id);
		expect(topicHistory.usedTopicLanes.map((lane) => lane.topic)).toContain(
			"space",
		);
		expect(topicHistory.usedTopicLanes[0].count).toBeGreaterThan(1);
	});

	it("validates V2 plans and preserves V1 compatibility", () => {
		const v1 = normalizePlaylistManagerPlan({
			version: 1,
			epoch: 1,
			windowSize: 1,
			strategySummary: "stay focused",
			transitionPolicy: "smooth",
			avoidPatterns: ["repeat title"],
			slots: [
				{
					slot: 1,
					transitionIntent: "continue",
					topicHint: "night drive",
					captionFocus: "analog bass",
					lyricTheme: "motion",
					energyTarget: "medium",
				},
			],
			updatedAt: 1,
		});
		expect(v1?.version).toBe(1);

		const v2 = withLegacySlotFields({
			version: 2,
			epoch: 2,
			startOrderIndex: 7,
			windowSize: 1,
			hardAnchors: ["cosmic disco"],
			softAnchors: ["warm synths"],
			variationBudget: "medium",
			elasticDimensions: ["topic"],
			forbiddenMoves: ["metal guitars"],
			diversityTargets: ["new lyrical angle"],
			strategySummary: "vary safely",
			transitionPolicy: "one move at a time",
			topicLanes: [{ id: "lane-1", summary: "orbital club", anchors: [] }],
			slots: [
				{
					slot: 1,
					laneId: "lane-1",
					preservedAnchors: ["cosmic disco"],
					variationMoves: ["new imagery"],
					sonicFocus: "muted arps",
					lyricFocus: "orbital club",
					captionFocus: "muted arps and disco drums",
					energyTarget: "medium",
					noveltyTarget: "medium",
					avoidPatterns: [],
				},
			],
			criticNotes: [],
			updatedAt: 2,
		});
		const normalized = normalizePlaylistManagerPlan(v2);
		expect(normalized?.version).toBe(2);
		expect(normalized?.slots[0]).toMatchObject({
			topicHint: "orbital club",
			lyricTheme: "orbital club",
		});
	});

	it("normalizes old text providers to openai-codex", () => {
		expect(normalizeLlmProvider("ollama")).toBe("openai-codex");
		expect(normalizeLlmProvider("openrouter")).toBe("openai-codex");
		expect(resolveTextLlmProfile({ provider: "ollama", model: "" })).toEqual({
			provider: "openai-codex",
			model: "gpt-5.2",
		});
	});

	it("only required director questions block generation state", async () => {
		const playlist = await playlistService.create({
			name: "Questions",
			prompt: "ambient folk",
			llmProvider: "openai-codex",
			llmModel: "",
		});
		await postChannelMessage({
			playlistId: playlist.id,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "question",
			content: "Optional color preference?",
			data: { requiresAnswer: false },
		});
		expect(await listPendingRequiredQuestions(playlist.id)).toHaveLength(0);

		await postChannelMessage({
			playlistId: playlist.id,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "question",
			content: "Required language choice?",
			data: { requiresAnswer: true },
		});
		expect(await listPendingRequiredQuestions(playlist.id)).toHaveLength(1);
	});

	it("rejects answers to questions from another playlist", async () => {
		const playlistA = await playlistService.create({
			name: "A",
			prompt: "ambient folk",
			llmProvider: "openai-codex",
			llmModel: "",
		});
		const playlistB = await playlistService.create({
			name: "B",
			prompt: "garage rock",
			llmProvider: "openai-codex",
			llmModel: "",
		});
		const question = await postChannelMessage({
			playlistId: playlistA.id,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "question",
			content: "Required language choice?",
			data: { requiresAnswer: true },
		});

		await expect(
			answerDirectorQuestion({
				playlistId: playlistB.id,
				questionId: question.id,
				content: "English",
			}),
		).rejects.toThrow("does not belong");
		expect(await listPendingRequiredQuestions(playlistA.id)).toHaveLength(1);
	});

	it("stores human chat and wakes the director", async () => {
		const playlist = await playlistService.create({
			name: "Chat",
			prompt: "garage rock",
			llmProvider: "openai-codex",
			llmModel: "",
		});
		await postHumanChat({
			playlistId: playlist.id,
			content: "Make the next few songs grimier.",
		});

		await vi.waitFor(async () => {
			const messages = await readChannelMessages({
				playlistId: playlist.id,
				limit: 10,
			});
			expect(messages.map((message) => message.senderId)).toContain(
				"playlist-director",
			);
		});

		const db = getTestDb();
		const [row] = await db
			.select()
			.from(playlists)
			.where(eq(playlists.id, playlist.id));
		expect(row.promptEpoch).toBe(0);
	});
});
