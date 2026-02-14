/**
 * React Query hooks for the Infinitune API.
 *
 * Query hooks return data | undefined while loading.
 * Mutation hooks return async callback functions.
 * WebSocket events from the API server auto-invalidate relevant query keys.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Playlist, Song } from "../../../api-server/types";
import { api } from "./client";

// Re-export types for convenience
export type { Song, Playlist };

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

export function useSetSetting() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { key: string; value: string }) => {
			await api.post("/api/settings", args);
			qc.invalidateQueries({ queryKey: ["settings"] });
		},
		[qc],
	);
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

export function useCreatePlaylist() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
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
		}): Promise<Playlist> => {
			const result = await api.post<Playlist>("/api/playlists", args);
			qc.invalidateQueries({ queryKey: ["playlists"] });
			return result;
		},
		[qc],
	);
}

export function useUpdatePlaylistStatus() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; status: string }) => {
			await api.patch(`/api/playlists/${args.id}/status`, {
				status: args.status,
			});
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}

export function useUpdatePlaylistParams() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string } & Record<string, unknown>) => {
			const { id, ...params } = args;
			await api.patch(`/api/playlists/${id}/params`, params);
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}

export function useUpdatePlaylistPrompt() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; prompt: string }) => {
			await api.patch(`/api/playlists/${args.id}/prompt`, {
				prompt: args.prompt,
			});
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}

export function useDeletePlaylist() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string }) => {
			await api.del(`/api/playlists/${args.id}`);
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}

export function usePlaylistHeartbeatMutation() {
	return useCallback(async (args: { id: string }) => {
		await api.post(`/api/playlists/${args.id}/heartbeat`);
	}, []);
}

export function useIncrementSongsGenerated() {
	return useCallback(async (args: { id: string }) => {
		await api.post(`/api/playlists/${args.id}/increment-generated`);
	}, []);
}

export function useResetPlaylistDefaults() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string }) => {
			await api.post(`/api/playlists/${args.id}/reset-defaults`);
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}

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

export function useUpdateSongStatus() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; status: string; errorMessage?: string }) => {
			await api.patch(`/api/songs/${args.id}/status`, {
				status: args.status,
				errorMessage: args.errorMessage,
			});
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useCreatePending() {
	const qc = useQueryClient();
	return useCallback(
		async (args: {
			playlistId: string;
			orderIndex: number;
			isInterrupt?: boolean;
			interruptPrompt?: string;
			promptEpoch?: number;
		}): Promise<Song> => {
			const result = await api.post<Song>("/api/songs/create-pending", args);
			qc.invalidateQueries({ queryKey: ["songs"] });
			return result;
		},
		[qc],
	);
}

export function useCreateMetadataReady() {
	const qc = useQueryClient();
	return useCallback(
		async (args: Record<string, unknown>): Promise<Song> => {
			const result = await api.post<Song>(
				"/api/songs/create-metadata-ready",
				args,
			);
			qc.invalidateQueries({ queryKey: ["songs"] });
			return result;
		},
		[qc],
	);
}

export function useCreateSong() {
	const qc = useQueryClient();
	return useCallback(
		async (args: Record<string, unknown>): Promise<Song> => {
			const result = await api.post<Song>("/api/songs", args);
			qc.invalidateQueries({ queryKey: ["songs"] });
			return result;
		},
		[qc],
	);
}

export function useSetRating() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; rating: "up" | "down" }) => {
			await api.post(`/api/songs/${args.id}/rating`, {
				rating: args.rating,
			});
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useUpdatePersonaExtract() {
	return useCallback(async (args: { id: string; personaExtract: string }) => {
		await api.patch(`/api/songs/${args.id}/persona-extract`, {
			personaExtract: args.personaExtract,
		});
	}, []);
}

export function useReorderSong() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; newOrderIndex: number }) => {
			await api.patch(`/api/songs/${args.id}/order`, {
				newOrderIndex: args.newOrderIndex,
			});
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useReindexPlaylist() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { playlistId: string }) => {
			await api.post(`/api/songs/reindex/${args.playlistId}`);
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useDeleteSong() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string }) => {
			await api.del(`/api/songs/${args.id}`);
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useRevertSong() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string }) => {
			await api.post(`/api/songs/${args.id}/revert`);
			qc.invalidateQueries({ queryKey: ["songs"] });
		},
		[qc],
	);
}

export function useUpdateAceTask() {
	return useCallback(async (args: { id: string; aceTaskId: string }) => {
		await api.patch(`/api/songs/${args.id}/ace-task`, {
			aceTaskId: args.aceTaskId,
		});
	}, []);
}

export function useUpdateCover() {
	return useCallback(async (args: { id: string; coverUrl: string }) => {
		await api.patch(`/api/songs/${args.id}/cover`, {
			coverUrl: args.coverUrl,
		});
	}, []);
}

export function useUpdateStoragePath() {
	return useCallback(
		async (args: {
			id: string;
			storagePath: string;
			aceAudioPath?: string;
		}) => {
			await api.patch(`/api/songs/${args.id}/storage-path`, {
				storagePath: args.storagePath,
				aceAudioPath: args.aceAudioPath,
			});
		},
		[],
	);
}

export function useMarkReady() {
	return useCallback(
		async (args: {
			id: string;
			audioUrl: string;
			audioProcessingMs?: number;
		}) => {
			await api.post(`/api/songs/${args.id}/mark-ready`, {
				audioUrl: args.audioUrl,
				audioProcessingMs: args.audioProcessingMs,
			});
		},
		[],
	);
}

export function useAddPlayDuration() {
	return useCallback(async (args: { id: string; durationMs: number }) => {
		await api.post(`/api/songs/${args.id}/play-duration`, {
			durationMs: args.durationMs,
		});
	}, []);
}

export function useAddListen() {
	return useCallback(async (args: { id: string }) => {
		await api.post(`/api/songs/${args.id}/listen`);
	}, []);
}

// ─── Playlist & Song Batch Hooks ─────────────────────────────────────

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

export function useSongsBatch(ids: string[]): Song[] | undefined {
	const key = ids.slice().sort().join(",");
	const { data } = useQuery({
		queryKey: ["songs", "batch", key],
		queryFn: () => api.post<Song[]>("/api/songs/batch", { ids }),
		enabled: ids.length > 0,
	});
	return ids.length > 0 ? data : [];
}

export function useUpdatePlaylistPosition() {
	const qc = useQueryClient();
	return useCallback(
		async (args: { id: string; currentOrderIndex: number }) => {
			await api.patch(`/api/playlists/${args.id}/position`, {
				currentOrderIndex: args.currentOrderIndex,
			});
			qc.invalidateQueries({ queryKey: ["playlists"] });
		},
		[qc],
	);
}
