import { normalizeLlmProvider } from "@infinitune/shared/text-llm-profile";
import type {
	LlmProvider,
	PlaylistManagerPlan,
	PlaylistManagerPlanV2,
} from "@infinitune/shared/types";
import {
	normalizePlaylistManagerPlan,
	withLegacySlotFields,
} from "@infinitune/shared/validation/manager-plan";
import { emit } from "../events/event-bus";
import {
	generatePlaylistManagerPlan,
	type ManagerRatingSignal,
	type RecentSong,
} from "../external/llm";
import { promptInfinituneAgent } from "../external/pi-runtime";
import { logger } from "../logger";
import * as playlistService from "../services/playlist-service";
import * as songService from "../services/song-service";
import { playlistToWire } from "../wire";
import { getAgentSessionKey } from "./agent-registry";
import {
	getChannelMessage,
	listPendingRequiredQuestions,
	markChannelQuestionAnswered,
	postChannelMessage,
	readChannelMessages,
} from "./channel-store";
import { writeMemory } from "./memory-store";
import { completeAgentRun, createAgentRun, failAgentRun } from "./run-store";
import {
	getPlaylistOverviewData,
	getRecentSongsData,
	getTopicHistoryData,
} from "./tools/playlist-context-tools";
import { getSourceSongCandidateFacts } from "./tools/web-tools";

type MemoryTrigger =
	| "rating"
	| "user-chat"
	| "steering"
	| "completed-song"
	| "long-channel";
type SongLike = Awaited<ReturnType<typeof songService.listByPlaylist>>[number];

export const MAX_HUMAN_CHAT_CONTENT_CHARS = 4_000;

function normalizeHumanChannelContent(input: string): {
	content: string;
	truncated: boolean;
	originalChars: number;
} {
	const normalizedContent = input.trim();
	if (!normalizedContent) throw new Error("Chat message content is required");
	const content =
		normalizedContent.length > MAX_HUMAN_CHAT_CONTENT_CHARS
			? normalizedContent.slice(0, MAX_HUMAN_CHAT_CONTENT_CHARS)
			: normalizedContent;
	return {
		content,
		truncated: normalizedContent.length > content.length,
		originalChars: normalizedContent.length,
	};
}

export class DirectorQuestionValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DirectorQuestionValidationError";
	}
}

function nonEmpty(value?: string | null): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function toRecentSong(song: SongLike): RecentSong | null {
	if (!song.title || !song.artistName || !song.genre || !song.subGenre) {
		return null;
	}
	return {
		title: song.title,
		artistName: song.artistName,
		genre: song.genre,
		subGenre: song.subGenre,
		vocalStyle: nonEmpty(song.vocalStyle),
		mood: nonEmpty(song.mood),
		energy: nonEmpty(song.energy),
	};
}

function toManagerRating(song: SongLike): ManagerRatingSignal | null {
	if (song.userRating !== "up" && song.userRating !== "down") return null;
	return {
		title: song.title || "Untitled",
		genre: nonEmpty(song.genre),
		mood: nonEmpty(song.mood),
		personaExtract: nonEmpty(song.personaExtract),
		rating: song.userRating,
	};
}

function fallbackPlan(input: {
	prompt: string;
	epoch: number;
	startOrderIndex: number;
	windowSize: number;
	reason: string;
}): PlaylistManagerPlanV2 {
	const promptAnchor = input.prompt.trim() || "preserve the playlist prompt";
	const slots = Array.from({ length: input.windowSize }, (_, index) => {
		const slot = index + 1;
		return {
			slot,
			laneId: `fallback-lane-${slot}`,
			preservedAnchors: [promptAnchor],
			variationMoves: [
				slot === 1
					? "restate the playlist identity clearly"
					: "shift topic and texture without changing the core ask",
			],
			sonicFocus:
				slot % 2 === 0
					? "change instrumentation color while keeping production coherent"
					: "keep the main production palette stable",
			lyricFocus:
				slot % 2 === 0
					? "use a fresh narrative angle"
					: "advance the central emotional world",
			captionFocus:
				"rich ACE-Step audio-type prompt with genre stack, groove, arrangement, vocal treatment, production texture, and broad tag tail",
			energyTarget: slot % 3 === 0 ? "high" : "medium",
			noveltyTarget: slot === 1 ? "low" : slot % 3 === 0 ? "high" : "medium",
			avoidPatterns: [
				"duplicate titles",
				"contradicting explicit user anchors",
			],
		} satisfies PlaylistManagerPlanV2["slots"][number];
	});
	return withLegacySlotFields({
		version: 2,
		epoch: input.epoch,
		startOrderIndex: input.startOrderIndex,
		windowSize: input.windowSize,
		hardAnchors: [promptAnchor],
		softAnchors: ["coherent playlist identity", "listener feedback"],
		variationBudget: "medium",
		elasticDimensions: [
			"topic",
			"instrumentation",
			"vocal style",
			"mood",
			"energy",
			"era",
			"lyrical angle",
		],
		forbiddenMoves: [
			"ignore explicit user constraints",
			"repeat recent titles",
		],
		diversityTargets: [
			"vary lyrical worlds",
			"rotate texture and arrangement details",
			"avoid duplicating recent song identities",
		],
		strategySummary:
			"Conservative fallback plan: preserve the playlist request and vary only elastic dimensions.",
		transitionPolicy:
			"Move one audible element at a time so each song remains connected to the original ask.",
		topicLanes: slots.map((slot) => ({
			id: slot.laneId,
			summary: slot.lyricFocus,
			anchors: [promptAnchor],
		})),
		slots,
		criticNotes: [`Fallback used: ${input.reason}`],
		updatedAt: Date.now(),
	});
}

function addStartOrder(
	plan: PlaylistManagerPlan,
	startOrderIndex: number,
): PlaylistManagerPlan {
	const normalized = normalizePlaylistManagerPlan({
		...plan,
		startOrderIndex,
	});
	if (normalized) return normalized;
	return plan.version === 2
		? withLegacySlotFields({ ...plan, startOrderIndex })
		: { ...plan, startOrderIndex };
}

function formatInitialPlanForHuman(plan: PlaylistManagerPlan): string {
	const normalized = normalizePlaylistManagerPlan(plan);
	const hardAnchors =
		normalized?.version === 2 ? normalized.hardAnchors.slice(0, 4) : [];
	const variationBudget =
		normalized?.version === 2 ? normalized.variationBudget : "medium";
	return [
		"Initial director plan:",
		"- I will treat the prompt as a source-song reimagining playlist, not as a request for invented songs.",
		"- I will pick globally recognizable source songs from broad popularity/history signals, then change the genre per track.",
		"- I will use the original source title and artist in metadata with a clear reimagining label.",
		"- I will preserve the source song's broad mood, premise, and story shape while writing new lyrics unless the text is public domain or rights-approved.",
		"- I will avoid repeating a source song inside the current listening window; repeats are only acceptable after a long gap or if you explicitly ask.",
		`- Variation budget: ${variationBudget}. I will rotate target genres, era, energy, vocal approach, and production texture.`,
		hardAnchors.length
			? `- Hard anchors: ${hardAnchors.join("; ")}`
			: undefined,
	]
		.filter(Boolean)
		.join("\n");
}

async function postSpecialistNotes(input: {
	playlistId: string;
	correlationId: string;
}) {
	const [overview, recentSongs, topicHistory] = await Promise.all([
		getPlaylistOverviewData(input.playlistId),
		getRecentSongsData(input.playlistId, 12),
		getTopicHistoryData(input.playlistId),
	]);
	const prompt = overview.playlist.prompt || "playlist";
	const recentTitles = recentSongs
		.flatMap((song) => (song.title ? [song.title] : []))
		.slice(0, 6);
	await Promise.all([
		postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "topic-scout",
			messageType: "proposal",
			visibility: "collapsed",
			content: `Fresh lanes should preserve "${prompt.slice(0, 120)}" while avoiding recent repeats${recentTitles.length ? `: ${recentTitles.join(", ")}` : "."} If the playlist uses famous source songs, assign one distinct source title and artist per upcoming slot.`,
			data: {
				usedTopicLanes: topicHistory.usedTopicLanes.slice(0, 12),
				recentTitles,
			},
			correlationId: input.correlationId,
		}),
		postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "production-designer",
			messageType: "proposal",
			visibility: "collapsed",
			content:
				"Write ACE-Step captions as rich audio-type prompts: genre stack, groove, core instruments, section movement, vocal treatment, production effects, and broad tag tail. Do not include BPM/key/time signature/duration.",
			data: overview.playlist,
			correlationId: input.correlationId,
		}),
		postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "lyric-dramatist",
			messageType: "proposal",
			visibility: "collapsed",
			content:
				"Vary lyrical worlds slot by slot while preserving explicit playlist anchors and language lock.",
			data: {
				language: overview.playlist.language,
				recentDescriptions: recentSongs
					.flatMap((song) => (song.description ? [song.description] : []))
					.slice(0, 8),
			},
			correlationId: input.correlationId,
		}),
		postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "continuity-critic",
			messageType: "critique",
			visibility: "collapsed",
			content:
				"Plan is acceptable only if hard anchors are explicit and recent titles, artist names, source songs, and story angles are not repeated inside the current listening window.",
			data: {
				preserveEpoch: overview.playlist.epoch,
				counts: overview.counts,
			},
			correlationId: input.correlationId,
		}),
	]);
}

export async function refreshPlaylistPlanWithDirector(input: {
	playlistId: string;
	provider: LlmProvider | string;
	model: string;
	startOrderIndex: number;
	planWindow?: number;
	signal?: AbortSignal;
}): Promise<{ managerBrief: string; managerPlan: PlaylistManagerPlan }> {
	const playlistRow = await playlistService.getById(input.playlistId);
	if (!playlistRow) throw new Error(`Playlist not found: ${input.playlistId}`);
	const playlist = playlistToWire(playlistRow);
	const planWindow = Math.max(1, Math.min(input.planWindow ?? 5, 12));
	const correlationId = `plan:${playlist.id}:${playlist.promptEpoch ?? 0}:${input.startOrderIndex}`;
	const run = await createAgentRun({
		playlistId: playlist.id,
		agentId: "playlist-director",
		sessionKey: getAgentSessionKey("playlist-director", playlist.id),
		trigger: "manager-plan",
		input: {
			epoch: playlist.promptEpoch ?? 0,
			startOrderIndex: input.startOrderIndex,
			planWindow,
		},
	});

	await postChannelMessage({
		playlistId: playlist.id,
		senderKind: "tool",
		senderId: "playlist-manager",
		messageType: "tool_summary",
		visibility: "collapsed",
		content: "Manager plan is stale; waking playlist director and specialists.",
		data: {
			epoch: playlist.promptEpoch ?? 0,
			startOrderIndex: input.startOrderIndex,
			planWindow,
		},
		correlationId,
	});

	try {
		await postSpecialistNotes({ playlistId: playlist.id, correlationId });
		const songs = await songService.listByPlaylist(playlist.id);
		const recentSongs = songs
			.slice()
			.sort((a, b) => b.orderIndex - a.orderIndex)
			.flatMap((song) => {
				const recent = toRecentSong(song);
				return recent ? [recent] : [];
			})
			.slice(0, 12);
		const recentDescriptions = songs
			.slice()
			.sort((a, b) => b.orderIndex - a.orderIndex)
			.flatMap((song) => (song.description ? [song.description] : []))
			.slice(0, 20);
		const ratingSignals = songs
			.flatMap((song) => {
				const signal = toManagerRating(song);
				return signal ? [signal] : [];
			})
			.slice(0, 20);
		const sourceResearch = await getSourceSongCandidateFacts({
			playlistPrompt: playlist.prompt,
			limit: 12,
		}).catch((err) => {
			logger.warn(
				{ err, playlistId: playlist.id },
				"Source-song web research failed",
			);
			return { queries: [], results: [] };
		});
		if (sourceResearch.results.length > 0) {
			await postChannelMessage({
				playlistId: playlist.id,
				senderKind: "tool",
				senderId: "web-research",
				messageType: "tool_summary",
				visibility: "collapsed",
				content:
					"Fetched public web context for source-song popularity and chart/list selection.",
				data: {
					queries: sourceResearch.queries,
					resultCount: sourceResearch.results.length,
					results: sourceResearch.results.slice(0, 8),
				},
				correlationId,
			});
		}
		const result = await generatePlaylistManagerPlan({
			prompt: playlist.prompt,
			provider: normalizeLlmProvider(input.provider),
			model: input.model,
			lyricsLanguage: playlist.lyricsLanguage ?? undefined,
			recentSongs,
			recentDescriptions,
			ratingSignals,
			webResearch: sourceResearch.results.map(
				(result, index) =>
					`${index + 1}. ${result.title}: ${result.snippet} (${result.url})`,
			),
			steerHistory: playlist.steerHistory,
			previousBrief: playlist.managerBrief,
			currentEpoch: playlist.promptEpoch ?? 0,
			planWindow,
			signal: input.signal,
		});
		const managerPlan = addStartOrder(
			result.managerPlan,
			input.startOrderIndex,
		);
		await playlistService.updateManagerBrief(playlist.id, {
			managerBrief: result.managerBrief,
			managerPlan: JSON.stringify(managerPlan),
			managerEpoch: playlist.promptEpoch ?? 0,
		});
		await postChannelMessage({
			playlistId: playlist.id,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "decision",
			content: "Saved director-approved V2 playlist plan.",
			data: { managerPlan },
			correlationId,
		});
		await completeAgentRun(run.id, { managerPlan });
		return { managerBrief: result.managerBrief, managerPlan };
	} catch (err) {
		const managerPlan = fallbackPlan({
			prompt: playlist.prompt,
			epoch: playlist.promptEpoch ?? 0,
			startOrderIndex: input.startOrderIndex,
			windowSize: planWindow,
			reason: err instanceof Error ? err.message : String(err),
		});
		const managerBrief =
			"Fallback director brief: preserve explicit playlist anchors, keep language and generation constraints, and vary only topic, texture, and lyrical angle.";
		await playlistService.updateManagerBrief(playlist.id, {
			managerBrief,
			managerPlan: JSON.stringify(managerPlan),
			managerEpoch: playlist.promptEpoch ?? 0,
		});
		await postChannelMessage({
			playlistId: playlist.id,
			senderKind: "tool",
			senderId: "playlist-manager",
			messageType: "tool_summary",
			visibility: "collapsed",
			content: "Director fallback saved a conservative V2 plan.",
			data: {
				error: err instanceof Error ? err.message : String(err),
				managerPlan,
			},
			correlationId,
		});
		await failAgentRun(run.id, err);
		return { managerBrief, managerPlan };
	}
}

export async function initializePlaylistDirectorPlan(input: {
	playlistId: string;
	provider: LlmProvider | string;
	model: string;
	signal?: AbortSignal;
}): Promise<void> {
	await postChannelMessage({
		playlistId: input.playlistId,
		senderKind: "tool",
		senderId: "playlist-director",
		messageType: "tool_summary",
		visibility: "collapsed",
		content:
			"Initial prompt received; building the director plan before generation starts.",
	});
	const result = await refreshPlaylistPlanWithDirector({
		playlistId: input.playlistId,
		provider: input.provider,
		model: input.model,
		startOrderIndex: 1,
		planWindow: 5,
		signal: input.signal,
	});
	await postChannelMessage({
		playlistId: input.playlistId,
		senderKind: "agent",
		senderId: "playlist-director",
		messageType: "chat",
		content: formatInitialPlanForHuman(result.managerPlan),
		data: {
			trigger: "initial-prompt-plan",
			planVersion: result.managerPlan.version,
		},
	});
}

export async function wakePlaylistDirector(input: {
	playlistId: string;
	trigger: "human-chat" | "answer";
	userMessage?: string;
	messageId?: string;
}): Promise<void> {
	const run = await createAgentRun({
		playlistId: input.playlistId,
		agentId: "playlist-director",
		sessionKey: getAgentSessionKey("playlist-director", input.playlistId),
		trigger: input.trigger,
		input,
	});
	try {
		const recent = await readChannelMessages({
			playlistId: input.playlistId,
			limit: 20,
		});
		let text = "";
		try {
			text = await promptInfinituneAgent({
				agentId: "playlist-director",
				scopeId: input.playlistId,
				prompt: [
					`Playlist ID: ${input.playlistId}`,
					`Trigger: ${input.trigger}`,
					input.userMessage ? `Human message: ${input.userMessage}` : "",
					"Read playlist context, memory, and channel if needed. Reply to the human or post a decision only if committing a steering change.",
					`Recent channel JSON: ${JSON.stringify(recent.slice(-12))}`,
				]
					.filter(Boolean)
					.join("\n\n"),
			});
		} catch (err) {
			logger.warn(
				{ err, playlistId: input.playlistId },
				"Pi playlist director unavailable; using local chat fallback",
			);
		}
		await postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "chat",
			content:
				text ||
				"I noted that for this playlist. I will keep the original anchors intact and fold useful steering into the next plan refresh.",
			data: {
				trigger: input.trigger,
				sourceMessageId: input.messageId,
				fallback: !text,
			},
		});
		await completeAgentRun(run.id, { response: text || "fallback" });
	} catch (err) {
		await failAgentRun(run.id, err);
		throw err;
	}
}

export async function postHumanChat(input: {
	playlistId: string;
	content: string;
	threadId?: string | null;
	commitDirection?: boolean;
}): Promise<{ messageId: string; committedDirection: boolean }> {
	const { content, truncated, originalChars } = normalizeHumanChannelContent(
		input.content,
	);
	const message = await postChannelMessage({
		playlistId: input.playlistId,
		threadId: input.threadId,
		senderKind: "human",
		senderId: "human",
		messageType: "chat",
		content,
		data: {
			committedDirection: input.commitDirection === true,
			...(truncated ? { truncated: true, originalChars } : {}),
		},
	});
	const slashSteer = content.startsWith("/steer ")
		? content.slice("/steer ".length).trim()
		: "";
	const shouldCommit = input.commitDirection === true || !!slashSteer;
	if (shouldCommit) {
		await playlistService.steer(input.playlistId, slashSteer || content);
		await postChannelMessage({
			playlistId: input.playlistId,
			senderKind: "agent",
			senderId: "playlist-director",
			messageType: "decision",
			content: "Committed a playlist steering decision from chat.",
			data: { prompt: slashSteer || content },
		});
	}
	queueMicrotask(() => {
		wakePlaylistDirector({
			playlistId: input.playlistId,
			trigger: "human-chat",
			userMessage: content,
			messageId: message.id,
		}).catch((err) =>
			logger.error(
				{ err, playlistId: input.playlistId },
				"Director wake failed",
			),
		);
		scheduleMemoryCurator({
			playlistId: input.playlistId,
			trigger: shouldCommit ? "steering" : "user-chat",
			content,
		}).catch((err) =>
			logger.error(
				{ err, playlistId: input.playlistId },
				"Memory curator failed",
			),
		);
	});
	return { messageId: message.id, committedDirection: shouldCommit };
}

export async function answerDirectorQuestion(input: {
	playlistId: string;
	questionId: string;
	content: string;
}): Promise<{ messageId: string }> {
	const { content, truncated, originalChars } = normalizeHumanChannelContent(
		input.content,
	);
	const question = await getChannelMessage(input.questionId);
	if (!question) {
		throw new DirectorQuestionValidationError("Director question not found");
	}
	if (question.playlistId !== input.playlistId) {
		throw new DirectorQuestionValidationError(
			"Director question does not belong to this playlist",
		);
	}
	if (question.messageType !== "question") {
		throw new DirectorQuestionValidationError(
			"Channel message is not a director question",
		);
	}
	const questionData =
		question.data && typeof question.data === "object"
			? (question.data as { answeredAt?: unknown })
			: null;
	if (questionData?.answeredAt) {
		throw new DirectorQuestionValidationError(
			"Director question has already been answered",
		);
	}
	const message = await postChannelMessage({
		playlistId: input.playlistId,
		threadId: question.threadId ?? input.questionId,
		senderKind: "human",
		senderId: "human",
		messageType: "chat",
		content,
		data: {
			answersQuestionId: input.questionId,
			...(truncated ? { truncated: true, originalChars } : {}),
		},
	});
	await markChannelQuestionAnswered({
		id: input.questionId,
		answeredBy: "human",
		answerMessageId: message.id,
	});
	emit("playlist.updated", { playlistId: input.playlistId });
	queueMicrotask(() => {
		wakePlaylistDirector({
			playlistId: input.playlistId,
			trigger: "answer",
			userMessage: content,
			messageId: message.id,
		}).catch((err) =>
			logger.error(
				{ err, playlistId: input.playlistId },
				"Director wake failed",
			),
		);
	});
	return { messageId: message.id };
}

export async function getPlaylistChatState(playlistId: string) {
	const requiredQuestions = await listPendingRequiredQuestions(playlistId);
	return {
		playlistId,
		requiredQuestions,
		generationBlocked: requiredQuestions.length > 0,
	};
}

export async function hasBlockingDirectorQuestion(
	playlistId: string,
): Promise<boolean> {
	const state = await getPlaylistChatState(playlistId);
	return state.generationBlocked;
}

export async function scheduleMemoryCurator(input: {
	playlistId?: string | null;
	songId?: string;
	trigger: MemoryTrigger;
	content?: string;
}): Promise<void> {
	try {
		if (input.trigger === "rating" && input.songId) {
			const song = (await songService.getByIds([input.songId]))[0];
			if (!song?.userRating) return;
			await writeMemory({
				scope: "playlist",
				playlistId: song.playlistId,
				kind: song.userRating === "up" ? "taste" : "avoid",
				title: `${song.userRating === "up" ? "Liked" : "Disliked"}: ${song.title || "Untitled"}`,
				content: {
					songId: song.id,
					title: song.title,
					artistName: song.artistName,
					genre: song.genre,
					subGenre: song.subGenre,
					mood: song.mood,
					energy: song.energy,
					vocalStyle: song.vocalStyle,
					personaExtract: song.personaExtract,
					signal: song.userRating,
				},
				confidence: 0.75,
				importance: song.userRating === "up" ? 0.7 : 0.65,
			});
			return;
		}
		if (input.trigger === "completed-song" && input.songId) {
			const song = (await songService.getByIds([input.songId]))[0];
			if (!song?.title) return;
			await writeMemory({
				scope: "playlist",
				playlistId: song.playlistId,
				kind: "summary",
				title: `Completed song: ${song.title}`,
				content: {
					songId: song.id,
					title: song.title,
					genre: song.genre,
					subGenre: song.subGenre,
					mood: song.mood,
					energy: song.energy,
					themes: song.themes,
					description: song.description,
				},
				confidence: 0.6,
				importance: 0.35,
			});
			return;
		}
		if (input.playlistId && input.content?.trim()) {
			await writeMemory({
				scope: "playlist",
				playlistId: input.playlistId,
				kind: input.trigger === "steering" ? "constraint" : "feedback",
				title:
					input.trigger === "steering"
						? "Chat steering note"
						: "Playlist chat note",
				content: {
					trigger: input.trigger,
					text: input.content.trim(),
				},
				confidence: input.trigger === "steering" ? 0.75 : 0.45,
				importance: input.trigger === "steering" ? 0.75 : 0.4,
			});
		}
	} catch (err) {
		logger.warn({ err, input }, "Memory curator fallback failed");
	}
}
