/**
 * React Query hooks for the Infinitune API.
 *
 * Query hooks return data | undefined while loading.
 * Mutation hooks return async callback functions.
 * WebSocket events from the API server auto-invalidate relevant query keys.
 */

import {
	type AuthSession,
	AuthSessionSchema,
	type CommandAction,
	type DeviceRecord,
	DeviceRecordSchema,
	type HouseCommandResponse,
	HouseCommandResponseSchema,
	type HouseSessionsResponse,
	HouseSessionsResponseSchema,
	type IssueDeviceTokenResponse,
	IssueDeviceTokenResponseSchema,
	type PlaylistDeviceAssignment,
	PlaylistDeviceAssignmentSchema,
	type PlaylistDeviceAssignmentsResponse,
	PlaylistDeviceAssignmentsResponseSchema,
	type PlaylistSessionInfo,
	PlaylistSessionInfoSchema,
} from "@infinitune/shared/protocol";
import type { Playlist, Song } from "@infinitune/shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import z from "zod";
import { resolveApiMediaUrl, resolveSongCover } from "@/lib/endpoints";
import { api } from "./client";

// Re-export types for convenience
export type { Playlist, Song };

// ─── Mutation Factory ────────────────────────────────────────────────

/**
 * Creates a mutation hook that returns an async callback function.
 * Automatically invalidates query keys on success and shows
 * a toast on error (unless `silent` is set).
 */
function createMutation<TInput, TOutput = void>(
	mutationFn: (input: TInput) => Promise<TOutput>,
	invalidateKeys?: string[][],
	options?: { silent?: boolean },
): () => (args: TInput) => Promise<TOutput> {
	const silent = options?.silent ?? false;
	return function useHook() {
		const qc = useQueryClient();
		return useCallback(
			async (args: TInput): Promise<TOutput> => {
				try {
					const result = await mutationFn(args);
					if (invalidateKeys) {
						for (const key of invalidateKeys) {
							qc.invalidateQueries({ queryKey: key });
						}
					}
					return result;
				} catch (err) {
					if (!silent) {
						toast.error(
							err instanceof Error
								? err.message
								: "An unexpected error occurred",
						);
					}
					throw err;
				}
			},
			[qc, mutationFn, invalidateKeys],
		);
	};
}

function normalizeSongMedia(song: Song): Song {
	return {
		...song,
		audioUrl: resolveApiMediaUrl(song.audioUrl),
		cover: resolveSongCover(song.cover),
	};
}

function normalizeSongList(songs: Song[] | undefined): Song[] | undefined {
	return songs?.map(normalizeSongMedia);
}

type PromptContract = {
	systemPrompt: string;
	schema: unknown;
};

export type AutoplayerModelOption = {
	name: string;
	displayName?: string;
	is_default?: boolean;
	is_loaded?: boolean;
	supportedTaskTypes?: string[];
	inputModalities?: string[];
	type?: string;
	vision?: boolean;
};

export type InferenceShImageModelOption = {
	id: string;
	name: string;
	priceLabel: string;
	pricePerImageUsd?: number;
	description: string;
};

export type AgentChannelSenderKind = "human" | "agent" | "system" | "tool";
export type AgentChannelMessageType =
	| "chat"
	| "proposal"
	| "critique"
	| "decision"
	| "question"
	| "memory_note"
	| "tool_summary";
export type AgentChannelVisibility = "public" | "collapsed";

export interface AgentChannelMessage {
	id: string;
	createdAt: number;
	playlistId: string;
	threadId: string | null;
	senderKind: AgentChannelSenderKind;
	senderId: string;
	messageType: AgentChannelMessageType;
	visibility: AgentChannelVisibility;
	content: string;
	data: unknown;
	correlationId: string | null;
}

export interface AgentChatState {
	playlistId: string;
	requiredQuestions: AgentChannelMessage[];
	generationBlocked: boolean;
}

export type AgentMemoryScope = "global" | "playlist";
export type AgentMemoryKind =
	| "taste"
	| "avoid"
	| "topic"
	| "constraint"
	| "production"
	| "lyrics"
	| "summary"
	| "feedback";

export interface AgentMemoryEntry {
	id: string;
	createdAt: number;
	updatedAt: number;
	scope: AgentMemoryScope;
	playlistId: string | null;
	kind: AgentMemoryKind;
	title: string;
	content: unknown;
	confidence: number;
	importance: number;
	useCount: number;
	lastUsedAt: number | null;
	expiresAt: number | null;
	deletedAt: number | null;
}

type TextModelOption = {
	name: string;
	displayName?: string;
};

function normalizePromptContract(payload: unknown): PromptContract | null {
	if (!payload || typeof payload !== "object") return null;
	const data = payload as {
		systemPrompt?: unknown;
		schema?: unknown;
	};
	return {
		systemPrompt:
			typeof data.systemPrompt === "string" ? data.systemPrompt : "",
		schema: data.schema ?? null,
	};
}

function extractAutoplayerModelOptions(
	payload: unknown,
): AutoplayerModelOption[] {
	if (!payload || typeof payload !== "object") return [];
	const models = (payload as { models?: unknown }).models;
	if (!Array.isArray(models)) return [];
	return models.flatMap((model) => {
		if (!model || typeof model !== "object") return [];
		const typedModel = model as {
			name?: unknown;
			displayName?: unknown;
			is_default?: unknown;
			is_loaded?: unknown;
			supportedTaskTypes?: unknown;
			inputModalities?: unknown;
			type?: unknown;
			vision?: unknown;
		};
		if (typeof typedModel.name !== "string") return [];
		return [
			{
				name: typedModel.name,
				displayName:
					typeof typedModel.displayName === "string"
						? typedModel.displayName
						: undefined,
				is_default:
					typeof typedModel.is_default === "boolean"
						? typedModel.is_default
						: undefined,
				is_loaded:
					typeof typedModel.is_loaded === "boolean"
						? typedModel.is_loaded
						: undefined,
				supportedTaskTypes: Array.isArray(typedModel.supportedTaskTypes)
					? typedModel.supportedTaskTypes.flatMap((item) =>
							typeof item === "string" ? [item] : [],
						)
					: undefined,
				inputModalities: Array.isArray(typedModel.inputModalities)
					? typedModel.inputModalities.flatMap((item) =>
							typeof item === "string" ? [item] : [],
						)
					: undefined,
				type: typeof typedModel.type === "string" ? typedModel.type : undefined,
				vision:
					typeof typedModel.vision === "boolean"
						? typedModel.vision
						: undefined,
			},
		];
	});
}

function extractInferenceShImageModels(
	payload: unknown,
): InferenceShImageModelOption[] {
	if (!payload || typeof payload !== "object") return [];
	const models = (payload as { models?: unknown }).models;
	if (!Array.isArray(models)) return [];
	return models.flatMap((model) => {
		if (!model || typeof model !== "object") return [];
		const typedModel = model as {
			id?: unknown;
			name?: unknown;
			priceLabel?: unknown;
			pricePerImageUsd?: unknown;
			description?: unknown;
		};
		if (
			typeof typedModel.id !== "string" ||
			typeof typedModel.name !== "string" ||
			typeof typedModel.priceLabel !== "string" ||
			typeof typedModel.description !== "string"
		) {
			return [];
		}
		return [
			{
				id: typedModel.id,
				name: typedModel.name,
				priceLabel: typedModel.priceLabel,
				pricePerImageUsd:
					typeof typedModel.pricePerImageUsd === "number"
						? typedModel.pricePerImageUsd
						: undefined,
				description: typedModel.description,
			},
		];
	});
}

function extractOllamaTextModelNames(payload: unknown): string[] {
	return extractAutoplayerModelOptions(payload).flatMap((model) =>
		model.type === "text" || (!model.type && !model.vision) ? [model.name] : [],
	);
}

function extractCodexTextModels(payload: unknown): TextModelOption[] {
	return extractAutoplayerModelOptions(payload).flatMap((model) =>
		model.type === "text"
			? [{ name: model.name, displayName: model.displayName }]
			: [],
	);
}

// ─── Settings ────────────────────────────────────────────────────────

export function useSettings(): Record<string, string> | undefined {
	const { data } = useQuery({
		queryKey: ["settings", "all"],
		queryFn: () => api.get<Record<string, string>>("/api/settings"),
	});
	return data;
}

export function useSetting(key: string): string | null | undefined {
	const { data } = useQuery({
		queryKey: ["settings", key],
		queryFn: () =>
			api.get<string | null>(`/api/settings/${encodeURIComponent(key)}`),
	});
	return data;
}

export function useAutoplayerPromptContract():
	| PromptContract
	| null
	| undefined {
	const { data } = useQuery({
		queryKey: ["autoplayer", "prompt-contract"],
		queryFn: async () =>
			normalizePromptContract(
				await api.get<unknown>("/api/autoplayer/prompt-contract"),
			),
	});
	return data;
}

export function useAutoplayerOllamaModels(
	enabled = true,
): AutoplayerModelOption[] | undefined {
	const { data } = useQuery({
		queryKey: ["autoplayer", "models", "ollama", "all"],
		queryFn: async () =>
			extractAutoplayerModelOptions(
				await api.get<unknown>("/api/autoplayer/ollama-models"),
			),
		enabled,
	});
	return data;
}

export function useAutoplayerAceModels(
	enabled = true,
): AutoplayerModelOption[] | undefined {
	const { data } = useQuery({
		queryKey: ["autoplayer", "models", "ace", "all"],
		queryFn: async () =>
			extractAutoplayerModelOptions(
				await api.get<unknown>("/api/autoplayer/ace-models"),
			),
		enabled,
	});
	return data;
}

export function useAutoplayerCodexModelsQuery(enabled = true) {
	return useQuery({
		queryKey: ["autoplayer", "models", "codex", "all"],
		queryFn: async () => {
			try {
				return extractAutoplayerModelOptions(
					await api.get<unknown>("/api/autoplayer/codex-models"),
				);
			} catch (error) {
				if (
					error instanceof Error &&
					(error.message.includes(": 401") ||
						error.message.toLowerCase().includes("unauthorized"))
				) {
					return [];
				}
				throw error;
			}
		},
		enabled,
		retry: false,
	});
}

export function useAutoplayerCodexModels(
	enabled = true,
): AutoplayerModelOption[] | undefined {
	const { data } = useAutoplayerCodexModelsQuery(enabled);
	return data;
}

export function useAutoplayerInferenceShImageModelsQuery(enabled = true) {
	return useQuery({
		queryKey: ["autoplayer", "models", "inference-sh", "image"],
		queryFn: async () =>
			extractInferenceShImageModels(
				await api.get<unknown>("/api/autoplayer/inference-sh-image-models"),
			),
		enabled,
	});
}

export function useAutoplayerInferenceShImageModels(
	enabled = true,
): InferenceShImageModelOption[] | undefined {
	const { data } = useAutoplayerInferenceShImageModelsQuery(enabled);
	return data;
}

export function useOllamaTextModels(enabled = true): string[] | undefined {
	const models = useAutoplayerOllamaModels(enabled);
	if (!models) return undefined;
	return extractOllamaTextModelNames({ models });
}

export function useCodexTextModels(
	enabled = true,
): TextModelOption[] | undefined {
	const codexModels = useAutoplayerCodexModels(enabled);
	if (!codexModels) return undefined;
	const data = extractCodexTextModels({ models: codexModels });
	return data;
}

export const useSetSetting = createMutation<{ key: string; value: string }>(
	(args) => api.post("/api/settings", args),
	[["settings"]],
);

// ─── Control Plane ────────────────────────────────────────────────────

const OkResponseSchema = z.object({
	ok: z.boolean(),
});

export function useControlAuthSession(): AuthSession | undefined {
	const { data } = useQuery({
		queryKey: ["control", "auth", "session"],
		queryFn: async () =>
			AuthSessionSchema.parse(await api.get<unknown>("/api/v1/auth/session")),
	});
	return data;
}

export function usePlaylistSessionInfo(
	playlistId: string | null,
): PlaylistSessionInfo | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "session", playlistId],
		queryFn: async () =>
			PlaylistSessionInfoSchema.parse(
				await api.get<unknown>(
					`/api/v1/playlists/${encodeURIComponent(playlistId ?? "")}/session`,
				),
			),
		enabled: !!playlistId,
	});
	return playlistId ? data : undefined;
}

export function useOwnedDevices(enabled = true): DeviceRecord[] | undefined {
	const { data } = useQuery({
		queryKey: ["devices", "owned"],
		queryFn: async () =>
			z
				.array(DeviceRecordSchema)
				.parse(await api.get<unknown>("/api/v1/devices")),
		enabled,
	});
	return data;
}

export function useDeviceAssignments(
	enabled = true,
): PlaylistDeviceAssignment[] | undefined {
	const { data } = useQuery({
		queryKey: ["devices", "assignments"],
		queryFn: async () =>
			z
				.array(PlaylistDeviceAssignmentSchema)
				.parse(await api.get<unknown>("/api/v1/devices/assignments")),
		enabled,
	});
	return data;
}

export function usePlaylistDeviceAssignments(
	playlistId: string | null,
): PlaylistDeviceAssignmentsResponse | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "devices", playlistId],
		queryFn: async () =>
			PlaylistDeviceAssignmentsResponseSchema.parse(
				await api.get<unknown>(
					`/api/v1/playlists/${encodeURIComponent(playlistId ?? "")}/devices`,
				),
			),
		enabled: !!playlistId,
	});
	return playlistId ? data : undefined;
}

export const useIssueDeviceToken = createMutation<
	{ name: string },
	IssueDeviceTokenResponse
>(
	async (args) =>
		IssueDeviceTokenResponseSchema.parse(
			await api.post<unknown>("/api/v1/devices", args),
		),
	[
		["devices", "owned"],
		["devices", "assignments"],
	],
);

export const useRenameOwnedDevice = createMutation<
	{ deviceId: string; name: string },
	DeviceRecord
>(
	async (args) =>
		DeviceRecordSchema.parse(
			await api.patch<unknown>(`/api/v1/devices/${args.deviceId}`, {
				name: args.name,
			}),
		),
	[["devices", "owned"]],
);

export const useRevokeOwnedDeviceToken = createMutation<
	{ deviceId: string },
	DeviceRecord
>(
	async (args) =>
		DeviceRecordSchema.parse(
			await api.post<unknown>(`/api/v1/devices/${args.deviceId}/revoke-token`),
		),
	[
		["devices", "owned"],
		["devices", "assignments"],
	],
);

export const useAssignDeviceToPlaylist = createMutation<
	{ playlistId: string; deviceId: string },
	PlaylistDeviceAssignment
>(
	async (args) =>
		PlaylistDeviceAssignmentSchema.parse(
			await api.post<unknown>(
				`/api/v1/playlists/${args.playlistId}/devices/${args.deviceId}/assign`,
			),
		),
	[["devices", "assignments"], ["devices", "owned"], ["playlists"]],
);

export const useUnassignDeviceFromPlaylist = createMutation<{
	playlistId: string;
	deviceId: string;
}>(
	async (args) => {
		OkResponseSchema.parse(
			await api.post<unknown>(
				`/api/v1/playlists/${args.playlistId}/devices/${args.deviceId}/unassign`,
			),
		);
	},
	[["devices", "assignments"], ["devices", "owned"], ["playlists"]],
);

export const useSendPlaylistCommand = createMutation<{
	playlistId: string;
	action: CommandAction;
	payload?: Record<string, unknown>;
	targetDeviceId?: string;
}>(
	async (args) => {
		OkResponseSchema.parse(await api.post<unknown>("/api/v1/commands", args));
	},
	[
		["playlists", "session"],
		["house", "sessions"],
	],
	{ silent: true },
);

export const useSendHouseCommand = createMutation<
	{
		action: CommandAction;
		payload?: Record<string, unknown>;
		targetDeviceId?: string;
		playlistIds?: string[];
	},
	HouseCommandResponse
>(
	async (args) =>
		HouseCommandResponseSchema.parse(
			await api.post<unknown>("/api/v1/house/commands", args),
		),
	[
		["playlists", "session"],
		["house", "sessions"],
	],
	{ silent: true },
);

export function useHouseSessions(
	enabled = true,
): HouseSessionsResponse | undefined {
	const { data } = useQuery({
		queryKey: ["house", "sessions"],
		queryFn: async () =>
			HouseSessionsResponseSchema.parse(
				await api.get<unknown>("/api/v1/house/sessions"),
			),
		enabled,
	});
	return data;
}

// ─── Playlists ───────────────────────────────────────────────────────

export function usePlaylistsAll(): Playlist[] | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "all"],
		queryFn: () => api.get<Playlist[]>("/api/playlists"),
	});
	return data;
}

export function usePlaylist(id: string | null): Playlist | null | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "get", id],
		queryFn: () => api.get<Playlist | null>(`/api/playlists/${id}`),
		enabled: !!id,
	});
	return id ? data : null;
}

export function useCurrentPlaylist(): Playlist | null | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "current"],
		queryFn: () => api.get<Playlist | null>("/api/playlists/current"),
	});
	return data;
}

export function useClosedPlaylists(): Playlist[] | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "closed"],
		queryFn: () => api.get<Playlist[]>("/api/playlists/closed"),
	});
	return data;
}

export function usePlaylistByKey(
	key: string | null,
): Playlist | null | undefined {
	const { data } = useQuery({
		queryKey: ["playlists", "by-key", key],
		queryFn: () =>
			api.get<Playlist | null>(
				`/api/playlists/by-key/${encodeURIComponent(key ?? "")}`,
			),
		enabled: !!key,
	});
	return key ? data : null;
}

export const useCreatePlaylist = createMutation<
	{
		name: string;
		prompt: string;
		llmProvider: string;
		llmModel: string;
		mode?: string;
		playlistKey?: string;
		lyricsLanguage?: string;
		targetBpm?: number;
		targetKey?: string;
		timeSignature?: string;
		audioDuration?: number;
		inferenceSteps?: number;
		lmTemperature?: number;
		lmCfgScale?: number;
		inferMethod?: string;
		aceModel?: string;
		aceDcwEnabled?: boolean;
		aceDcwMode?: string;
		aceDcwScaler?: number;
		aceDcwHighScaler?: number;
		aceDcwWavelet?: string;
		aceVaeCheckpoint?: string;
		aceThinking?: boolean;
		aceAutoDuration?: boolean;
		initialDirectorPlan?: boolean;
	},
	Playlist
>((args) => api.post<Playlist>("/api/playlists", args), [["playlists"]]);

export const useUpdatePlaylistStatus = createMutation<{
	id: string;
	status: string;
}>(
	(args) =>
		api.patch(`/api/playlists/${args.id}/status`, { status: args.status }),
	[["playlists"]],
);

export const useUpdatePlaylistParams = createMutation<
	{ id: string } & Record<string, unknown>
>(
	(args) => {
		const { id, ...params } = args;
		return api.patch(`/api/playlists/${id}/params`, params);
	},
	[["playlists"]],
);

export const useUpdatePlaylistPrompt = createMutation<{
	id: string;
	prompt: string;
}>(
	(args) =>
		api.patch(`/api/playlists/${args.id}/prompt`, { prompt: args.prompt }),
	[["playlists"]],
);

export const useTogglePlaylistStar = createMutation<{ id: string }>(
	(args) => api.patch(`/api/playlists/${args.id}/star`, {}),
	[["playlists"]],
);

export const useDeletePlaylist = createMutation<{ id: string }>(
	(args) => api.del(`/api/playlists/${args.id}`),
	[["playlists"]],
);

export const usePlaylistHeartbeatMutation = createMutation<{ id: string }>(
	(args) => api.post(`/api/playlists/${args.id}/heartbeat`),
	undefined,
	{ silent: true },
);

export const useIncrementSongsGenerated = createMutation<{ id: string }>(
	(args) => api.post(`/api/playlists/${args.id}/increment-generated`),
	undefined,
	{ silent: true },
);

export const useResetPlaylistDefaults = createMutation<{ id: string }>(
	(args) => api.post(`/api/playlists/${args.id}/reset-defaults`),
	[["playlists"]],
);

export const useUpdatePlaylistPosition = createMutation<{
	id: string;
	currentOrderIndex: number;
}>(
	(args) =>
		api.patch(`/api/playlists/${args.id}/position`, {
			currentOrderIndex: args.currentOrderIndex,
		}),
	[["playlists"]],
	{ silent: true },
);

// ─── Agent Channel + Memory ───────────────────────────────────────────

export function useAgentChatMessages(
	playlistId: string | null,
	limit = 100,
): AgentChannelMessage[] | undefined {
	const { data } = useQuery({
		queryKey: ["agent-chat", "messages", playlistId, limit],
		queryFn: async () => {
			const response = await api.get<{ messages: AgentChannelMessage[] }>(
				`/api/playlists/${encodeURIComponent(playlistId ?? "")}/agent-chat/messages?limit=${limit}`,
			);
			return response.messages;
		},
		enabled: !!playlistId,
		refetchInterval: 5000,
	});
	return playlistId ? data : undefined;
}

export function useAgentChatState(
	playlistId: string | null,
): AgentChatState | undefined {
	const { data } = useQuery({
		queryKey: ["agent-chat", "state", playlistId],
		queryFn: () =>
			api.get<AgentChatState>(
				`/api/playlists/${encodeURIComponent(playlistId ?? "")}/agent-chat/state`,
			),
		enabled: !!playlistId,
		refetchInterval: 5000,
	});
	return playlistId ? data : undefined;
}

export function usePostAgentChatMessage() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
			playlistId: string;
			content: string;
			threadId?: string | null;
			commitDirection?: boolean;
		}): Promise<{ messageId: string; committedDirection: boolean }> => {
			try {
				const result = await api.post<{
					messageId: string;
					committedDirection: boolean;
				}>(
					`/api/playlists/${encodeURIComponent(args.playlistId)}/agent-chat/messages`,
					{
						content: args.content,
						threadId: args.threadId,
						commitDirection: args.commitDirection,
					},
				);
				qc.invalidateQueries({
					queryKey: ["agent-chat", "messages", args.playlistId],
				});
				qc.invalidateQueries({
					queryKey: ["agent-chat", "state", args.playlistId],
				});
				qc.invalidateQueries({ queryKey: ["playlists"] });
				return result;
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Unable to send chat message",
				);
				throw err;
			}
		},
		[qc],
	);
}

export function useAnswerAgentQuestion() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
			playlistId: string;
			questionId: string;
			content: string;
		}): Promise<{ messageId: string }> => {
			try {
				const result = await api.post<{ messageId: string }>(
					`/api/playlists/${encodeURIComponent(args.playlistId)}/agent-chat/answer`,
					{ questionId: args.questionId, content: args.content },
				);
				qc.invalidateQueries({
					queryKey: ["agent-chat", "messages", args.playlistId],
				});
				qc.invalidateQueries({
					queryKey: ["agent-chat", "state", args.playlistId],
				});
				return result;
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Unable to answer question",
				);
				throw err;
			}
		},
		[qc],
	);
}

export function useAgentMemoryEntries(
	playlistId: string | null,
): AgentMemoryEntry[] | undefined {
	const { data } = useQuery({
		queryKey: ["agent-memory", "playlist", playlistId],
		queryFn: async () => {
			const [playlistMemory, globalMemory] = await Promise.all([
				api.get<{ entries: AgentMemoryEntry[] }>(
					`/api/agent-memory?scope=playlist&playlistId=${encodeURIComponent(
						playlistId ?? "",
					)}&limit=60`,
				),
				api.get<{ entries: AgentMemoryEntry[] }>(
					"/api/agent-memory?scope=global&limit=40",
				),
			]);
			const seen = new Set<string>();
			return [...playlistMemory.entries, ...globalMemory.entries].filter(
				(entry) => {
					if (seen.has(entry.id)) return false;
					seen.add(entry.id);
					return true;
				},
			);
		},
		enabled: !!playlistId,
		refetchInterval: 10_000,
	});
	return playlistId ? data : undefined;
}

export function useUpdateAgentMemoryEntry() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
			id: string;
			playlistId?: string | null;
			patch: Partial<
				Pick<
					AgentMemoryEntry,
					| "scope"
					| "playlistId"
					| "kind"
					| "title"
					| "content"
					| "confidence"
					| "importance"
					| "expiresAt"
				>
			>;
		}): Promise<AgentMemoryEntry> => {
			try {
				const result = await api.patch<{ entry: AgentMemoryEntry }>(
					`/api/agent-memory/${encodeURIComponent(args.id)}`,
					args.patch,
				);
				qc.invalidateQueries({ queryKey: ["agent-memory"] });
				if (args.playlistId) {
					qc.invalidateQueries({
						queryKey: ["agent-memory", "playlist", args.playlistId],
					});
				}
				return result.entry;
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Unable to update memory",
				);
				throw err;
			}
		},
		[qc],
	);
}

export function useDeleteAgentMemoryEntry() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
			id: string;
			playlistId?: string | null;
		}): Promise<AgentMemoryEntry> => {
			try {
				const result = await api.del<{ entry: AgentMemoryEntry }>(
					`/api/agent-memory/${encodeURIComponent(args.id)}`,
				);
				qc.invalidateQueries({ queryKey: ["agent-memory"] });
				if (args.playlistId) {
					qc.invalidateQueries({
						queryKey: ["agent-memory", "playlist", args.playlistId],
					});
				}
				return result.entry;
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Unable to delete memory",
				);
				throw err;
			}
		},
		[qc],
	);
}

// ─── Songs ───────────────────────────────────────────────────────────

export function useSongQueue(playlistId: string | null): Song[] | undefined {
	const { data } = useQuery({
		queryKey: ["songs", "queue", playlistId],
		queryFn: async () =>
			normalizeSongList(
				await api.get<Song[]>(`/api/songs/queue/${playlistId}`),
			) ?? [],
		enabled: !!playlistId,
	});
	return playlistId ? data : undefined;
}

export function useSongsAll(): Song[] | undefined {
	const { data } = useQuery({
		queryKey: ["songs", "all"],
		queryFn: async () =>
			normalizeSongList(await api.get<Song[]>("/api/songs")) ?? [],
	});
	return data;
}

export function useSongsBatch(ids: string[]): Song[] | undefined {
	const key = ids.slice().sort().join(",");
	const { data } = useQuery({
		queryKey: ["songs", "batch", key],
		queryFn: async () =>
			normalizeSongList(await api.post<Song[]>("/api/songs/batch", { ids })) ??
			[],
		enabled: ids.length > 0,
	});
	return ids.length > 0 ? data : [];
}

export const useUpdateSongStatus = createMutation<{
	id: string;
	status: string;
	errorMessage?: string;
}>(
	(args) =>
		api.patch(`/api/songs/${args.id}/status`, {
			status: args.status,
			errorMessage: args.errorMessage,
		}),
	[["songs"]],
	{ silent: true },
);

export const useCreatePending = createMutation<
	{
		playlistId: string;
		orderIndex: number;
		isInterrupt?: boolean;
		interruptPrompt?: string;
		promptEpoch?: number;
	},
	Song
>(
	(args) =>
		api.post<Song>("/api/songs/create-pending", args).then(normalizeSongMedia),
	[["songs"]],
	{
		silent: true,
	},
);

export const useCreateMetadataReady = createMutation<
	Record<string, unknown>,
	Song
>(
	(args) =>
		api
			.post<Song>("/api/songs/create-metadata-ready", args)
			.then(normalizeSongMedia),
	[["songs"]],
	{ silent: true },
);

export const useCreateSong = createMutation<Record<string, unknown>, Song>(
	(args) => api.post<Song>("/api/songs", args).then(normalizeSongMedia),
	[["songs"]],
	{ silent: true },
);

export const useSetRating = createMutation<{
	id: string;
	rating: "up" | "down";
}>(
	(args) => api.post(`/api/songs/${args.id}/rating`, { rating: args.rating }),
	[["songs"]],
);

export const useUpdatePersonaExtract = createMutation<{
	id: string;
	personaExtract: string;
}>(
	(args) =>
		api.patch(`/api/songs/${args.id}/persona-extract`, {
			personaExtract: args.personaExtract,
		}),
	undefined,
	{ silent: true },
);

export const useReorderSong = createMutation<{
	id: string;
	newOrderIndex: number;
}>(
	(args) =>
		api.patch(`/api/songs/${args.id}/order`, {
			newOrderIndex: args.newOrderIndex,
		}),
	[["songs"]],
);

export const useReindexPlaylist = createMutation<{ playlistId: string }>(
	(args) => api.post(`/api/songs/reindex/${args.playlistId}`),
	[["songs"]],
	{ silent: true },
);

export const useDeleteSong = createMutation<{ id: string }>(
	(args) => api.del(`/api/songs/${args.id}`),
	[["songs"]],
);

export const useRevertSong = createMutation<{ id: string }>(
	(args) => api.post(`/api/songs/${args.id}/revert`),
	[["songs"]],
);

export const useUpdateAceTask = createMutation<{
	id: string;
	aceTaskId: string;
}>(
	(args) =>
		api.patch(`/api/songs/${args.id}/ace-task`, {
			aceTaskId: args.aceTaskId,
		}),
	undefined,
	{ silent: true },
);

export const useUpdateCover = createMutation<{
	id: string;
	cover: Song["cover"];
}>(
	(args) => api.patch(`/api/songs/${args.id}/cover`, { cover: args.cover }),
	undefined,
	{ silent: true },
);

export const useUpdateStoragePath = createMutation<{
	id: string;
	storagePath: string;
	aceAudioPath?: string;
}>(
	(args) =>
		api.patch(`/api/songs/${args.id}/storage-path`, {
			storagePath: args.storagePath,
			aceAudioPath: args.aceAudioPath,
		}),
	undefined,
	{ silent: true },
);

export const useMarkReady = createMutation<{
	id: string;
	audioUrl: string;
	audioProcessingMs?: number;
}>(
	(args) =>
		api.post(`/api/songs/${args.id}/mark-ready`, {
			audioUrl: args.audioUrl,
			audioProcessingMs: args.audioProcessingMs,
		}),
	undefined,
	{ silent: true },
);

export const useAddPlayDuration = createMutation<{
	id: string;
	durationMs: number;
}>(
	(args) =>
		api.post(`/api/songs/${args.id}/play-duration`, {
			durationMs: args.durationMs,
		}),
	undefined,
	{ silent: true },
);

export const useAddListen = createMutation<{ id: string }>(
	(args) => api.post(`/api/songs/${args.id}/listen`),
	undefined,
	{ silent: true },
);
