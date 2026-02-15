/**
 * React Query hooks for the Infinitune API.
 *
 * Query hooks return data | undefined while loading.
 * Mutation hooks return async callback functions.
 * WebSocket events from the API server auto-invalidate relevant query keys.
 */

import type { Playlist, Song } from "@infinitune/shared/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
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

export const useSetSetting = createMutation<{ key: string; value: string }>(
	(args) => api.post("/api/settings", args),
	[["settings"]],
);

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

// ─── Songs ───────────────────────────────────────────────────────────

export function useSongQueue(playlistId: string | null): Song[] | undefined {
	const { data } = useQuery({
		queryKey: ["songs", "queue", playlistId],
		queryFn: () => api.get<Song[]>(`/api/songs/queue/${playlistId}`),
		enabled: !!playlistId,
	});
	return playlistId ? data : undefined;
}

export function useSongsAll(): Song[] | undefined {
	const { data } = useQuery({
		queryKey: ["songs", "all"],
		queryFn: () => api.get<Song[]>("/api/songs"),
	});
	return data;
}

export function useSongsBatch(ids: string[]): Song[] | undefined {
	const key = ids.slice().sort().join(",");
	const { data } = useQuery({
		queryKey: ["songs", "batch", key],
		queryFn: () => api.post<Song[]>("/api/songs/batch", { ids }),
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
>((args) => api.post<Song>("/api/songs/create-pending", args), [["songs"]], {
	silent: true,
});

export const useCreateMetadataReady = createMutation<
	Record<string, unknown>,
	Song
>(
	(args) => api.post<Song>("/api/songs/create-metadata-ready", args),
	[["songs"]],
	{ silent: true },
);

export const useCreateSong = createMutation<Record<string, unknown>, Song>(
	(args) => api.post<Song>("/api/songs", args),
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

export const useUpdateCover = createMutation<{ id: string; coverUrl: string }>(
	(args) =>
		api.patch(`/api/songs/${args.id}/cover`, { coverUrl: args.coverUrl }),
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
