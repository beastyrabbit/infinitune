import type { LlmProvider } from "@infinitune/shared/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Disc3, Minimize2, Plus, Radio, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceControlPanel } from "@/components/autoplayer/DeviceControlPanel";
import { DirectionSteering } from "@/components/autoplayer/DirectionSteering";
import { GenerationBanner } from "@/components/autoplayer/GenerationBanner";
import { GenerationControls } from "@/components/autoplayer/GenerationControls";
import { NowPlaying } from "@/components/autoplayer/NowPlaying";
import { PlaylistCreator } from "@/components/autoplayer/PlaylistCreator";

import { QueueGrid } from "@/components/autoplayer/QueueGrid";
import { QuickRequest } from "@/components/autoplayer/QuickRequest";
import { TrackDetail } from "@/components/autoplayer/TrackDetail";
import { UpNextBanner } from "@/components/autoplayer/UpNextBanner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VinylIcon from "@/components/ui/vinyl-icon";
import { useAutoplayer } from "@/hooks/useAutoplayer";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import { useRoomConnection } from "@/hooks/useRoomConnection";
import { useRoomController } from "@/hooks/useRoomController";
import { useRoomPlayer } from "@/hooks/useRoomPlayer";
import { useVolumeSync } from "@/hooks/useVolumeSync";
import type { EndpointStatus } from "@/hooks/useWorkerStatus";
import { useWorkerStatus } from "@/hooks/useWorkerStatus";
import {
	useCreateMetadataReady,
	useCreatePending,
	useCreatePlaylist,
	usePlaylist,
	usePlaylistByKey,
	useReindexPlaylist,
	useReorderSong,
	useSetRating,
	useSettings,
	useSongQueue,
	useUpdatePersonaExtract,
	useUpdatePlaylistStatus,
} from "@/integrations/api/hooks";
import { API_URL } from "@/lib/endpoints";
import { playerStore, setCurrentSong, stopPlayback } from "@/lib/player-store";
import {
	generatePlaylistKey,
	validatePlaylistKeySearch,
} from "@/lib/playlist-key";
import type { SongMetadata } from "@/services/llm";

function EndpointDot({
	label,
	status,
}: {
	label: string;
	status?: EndpointStatus | null;
}) {
	let dotClass = "bg-white/30"; // idle/grey
	if (status?.active && status.active > 0) dotClass = "bg-green-500";
	if (status?.errors && status.errors > 0) dotClass = "bg-red-500";
	return (
		<span className="flex items-center gap-1">
			{label}:
			<span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
		</span>
	);
}

export const Route = createFileRoute("/autoplayer")({
	component: AutoplayerPage,
	validateSearch: validatePlaylistKeySearch,
});

function AutoplayerPage() {
	const navigate = useNavigate();
	const { pl, room, role, name, dn } = Route.useSearch();
	const isRoomMode = !!room;
	const roomRole = role ?? "player";
	const deviceName = dn || `autoplayer-${roomRole}`;
	const [detailSongId, setDetailSongId] = useState<string | null>(null);
	const [forceCloseArmed, setForceCloseArmed] = useState(false);

	const [albumGenerating, setAlbumGenerating] = useState(false);
	const [albumProgress, setAlbumProgress] = useState({ current: 0, total: 0 });
	const albumAbortRef = useRef<AbortController | null>(null);

	// Look up playlist by key from URL
	const playlistByKey = usePlaylistByKey(pl ?? null);
	const playlistId = playlistByKey?.id ?? null;

	const createPlaylist = useCreatePlaylist();
	const updateStatus = useUpdatePlaylistStatus();
	const setRatingMut = useSetRating();

	// --- Room mode hooks (no-op when room is null) ---
	const roomConnection = useRoomConnection(
		room ?? null,
		deviceName,
		roomRole,
		pl,
		name,
	);
	const roomController = useRoomController(roomConnection);
	const roomPlayer = useRoomPlayer(
		isRoomMode && roomRole === "player" ? roomConnection : null,
	);

	// Room mode: query songs/playlist from API directly
	const roomSongs = useSongQueue(isRoomMode && playlistId ? playlistId : null);
	const roomPlaylist = usePlaylist(
		isRoomMode && playlistId ? playlistId : null,
	);

	// Local mode hooks (no-op when in room mode)
	const autoplayer = useAutoplayer(isRoomMode ? null : playlistId);

	const { currentSongId: localCurrentSongId } = useStore(playerStore);

	useVolumeSync();
	usePlaylistHeartbeat(playlistId);

	// --- Derive effective state ---
	const songs = isRoomMode ? roomSongs : autoplayer.songs;
	const playlist = isRoomMode ? roomPlaylist : autoplayer.playlist;
	const currentSongId = isRoomMode
		? roomConnection.playback.currentSongId
		: localCurrentSongId;

	// Navigate away when playlist transitions to closed (not on initial load)
	const prevStatusRef = useRef<string | null>(null);
	useEffect(() => {
		const status = playlist?.status ?? null;
		if (
			prevStatusRef.current &&
			prevStatusRef.current !== "closed" &&
			status === "closed"
		) {
			navigate({ to: "/autoplayer" });
		}
		prevStatusRef.current = status;
	}, [playlist?.status, navigate]);

	const { status: workerStatus } = useWorkerStatus();

	const currentSong = songs?.find((s) => s.id === currentSongId) ?? null;

	// Transition is complete once the currently playing song is from the current epoch
	const playlistEpoch = playlist?.promptEpoch ?? 0;
	const currentSongEpoch = currentSong ? (currentSong.promptEpoch ?? 0) : 0;
	const transitionDismissed = isRoomMode
		? false
		: autoplayer.transitionDismissed;
	const transitionComplete =
		playlistEpoch === 0 ||
		currentSongEpoch >= playlistEpoch ||
		transitionDismissed;

	// --- Unified action callbacks ---
	const toggle = isRoomMode ? roomController.toggle : autoplayer.toggle;
	const seek = isRoomMode ? roomController.seek : autoplayer.seek;
	const skipToNext = isRoomMode ? roomController.skip : autoplayer.skipToNext;
	const rateSong = useCallback(
		(songId: string, rating: "up" | "down") => {
			if (isRoomMode) {
				roomController.rate(songId, rating);
				setRatingMut({ id: songId, rating });
			} else {
				autoplayer.rateSong(songId, rating);
			}
		},
		[isRoomMode, roomController, autoplayer, setRatingMut],
	);
	const requestSong = autoplayer.requestSong;
	const loadAndPlay = autoplayer.loadAndPlay;
	const dismissTransition = autoplayer.dismissTransition;

	const createPending = useCreatePending();
	const createMetadataReady = useCreateMetadataReady();
	const updatePersonaExtract = useUpdatePersonaExtract();
	const reorderSong = useReorderSong();
	const reindexPlaylist = useReindexPlaylist();
	const settings = useSettings();
	const [albumSourceTitle, setAlbumSourceTitle] = useState<string | null>(null);

	/** Shared playlist creation: generates key, calls API mutation, returns the key. */
	const doCreatePlaylist = useCallback(
		async (data: {
			name: string;
			prompt: string;
			provider: LlmProvider;
			model: string;
			inferenceSteps?: number;
			lmTemperature?: number;
			lmCfgScale?: number;
			inferMethod?: string;
		}): Promise<string> => {
			const key = generatePlaylistKey();
			await createPlaylist({
				name: data.name,
				prompt: data.prompt,
				llmProvider: data.provider,
				llmModel: data.model,
				playlistKey: key,
				inferenceSteps: data.inferenceSteps,
				lmTemperature: data.lmTemperature,
				lmCfgScale: data.lmCfgScale,
				inferMethod: data.inferMethod,
			});
			return key;
		},
		[createPlaylist],
	);

	const handleCreatePlaylist = useCallback(
		async (data: Parameters<typeof doCreatePlaylist>[0]) => {
			const key = await doCreatePlaylist(data);
			navigate({ to: "/autoplayer", search: { pl: key } });
		},
		[doCreatePlaylist, navigate],
	);

	const handleCreatePlaylistInRoom = useCallback(
		async (data: Parameters<typeof doCreatePlaylist>[0]) => {
			const key = await doCreatePlaylist(data);

			// Create a room on the room server
			const roomId = data.name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 30);
			const roomServerUrl = API_URL;
			try {
				await fetch(`${roomServerUrl}/api/v1/rooms`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: roomId,
						name: data.name,
						playlistKey: key,
					}),
				});
			} catch {
				// Room server might not be running -- still navigate
			}

			navigate({
				to: "/autoplayer",
				search: { pl: key, room: roomId, role: "player", name: data.name },
			});
		},
		[doCreatePlaylist, navigate],
	);

	const handleAddBatch = useCallback(async () => {
		if (!playlistId || !songs) return;
		const maxOrder = songs.reduce(
			(max, s) => Math.max(max, s.orderIndex ?? 0),
			0,
		);
		await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				createPending({
					playlistId,
					orderIndex: maxOrder + i + 1,
					promptEpoch: playlist?.promptEpoch ?? 0,
				}),
			),
		);
	}, [playlistId, songs, playlist?.promptEpoch, createPending]);

	const handleAddAlbum = useCallback(async () => {
		if (!playlistId || !songs || !playlist || !currentSongId || albumGenerating)
			return;
		const sourceSong = songs.find((s) => s.id === currentSongId);
		if (!sourceSong?.title) return;

		const TOTAL_TRACKS = 15;
		const BATCH_SIZE = 5;
		const abortController = new AbortController();
		albumAbortRef.current = abortController;

		setAlbumGenerating(true);
		setAlbumProgress({ current: 0, total: TOTAL_TRACKS });
		setAlbumSourceTitle(sourceSong.title ?? null);

		try {
			const currentEpoch = playlist.promptEpoch ?? 0;

			// Resolve persona provider + model:
			// 1. Both explicitly set → use them
			// 2. Neither set (or matches text provider) → fall back to text pair
			// 3. Provider set but model empty + different from text → skip precheck
			const explicitPP = settings?.personaProvider || "";
			const explicitPM = settings?.personaModel || "";
			let pProvider: "ollama" | "openrouter" | "openai-codex";
			let pModel: string;
			if (explicitPM) {
				pProvider = (explicitPP || "ollama") as
					| "ollama"
					| "openrouter"
					| "openai-codex";
				pModel = explicitPM;
			} else if (!explicitPP || explicitPP === settings?.textProvider) {
				pProvider = (settings?.textProvider || "ollama") as
					| "ollama"
					| "openrouter"
					| "openai-codex";
				pModel = settings?.textModel || "";
			} else {
				pProvider = "ollama";
				pModel = ""; // will skip precheck below
			}

			// Precheck: ensure source + rated songs have personas before starting
			if (pModel) {
				const likedSongDocs = songs.filter(
					(s) => s.userRating && !s.personaExtract && s.title,
				);
				const songsNeedingPersona = [sourceSong, ...likedSongDocs].filter(
					(s) => s.userRating && !s.personaExtract && s.title,
				);
				if (songsNeedingPersona.length > 0) {
					const precheckPromises = songsNeedingPersona.map((s) =>
						fetch("/api/autoplayer/extract-persona", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								song: {
									title: s.title,
									artistName: s.artistName,
									genre: s.genre,
									subGenre: s.subGenre,
									mood: s.mood,
									energy: s.energy,
									era: s.era,
									vocalStyle: s.vocalStyle,
									instruments: s.instruments,
									themes: s.themes,
									description: s.description,
									lyrics: s.lyrics?.slice(0, 500),
								},
								provider: pProvider,
								model: pModel,
							}),
						})
							.then(async (res) => {
								if (!res.ok) return null;
								const data = await res.json();
								if (data.persona) {
									await updatePersonaExtract({
										id: s.id as Parameters<
											typeof updatePersonaExtract
										>[0]["id"],
										personaExtract: data.persona,
									});
								}
								return data.persona;
							})
							.catch(() => null),
					);
					await Promise.allSettled(precheckPromises);
				}
			}

			const likedSongs = songs
				.filter((s) => s.userRating === "up" && s.title)
				.map((s) => ({
					title: s.title as string,
					artistName: s.artistName as string,
					genre: s.genre as string,
					mood: s.mood,
					vocalStyle: s.vocalStyle,
				}));

			// Gather persona extracts from current-epoch liked songs
			const personaExtracts = songs
				.filter(
					(s) =>
						s.userRating === "up" &&
						s.personaExtract &&
						(s.promptEpoch ?? 0) === currentEpoch,
				)
				.map((s) => s.personaExtract as string);

			// Gather persona extracts from down-voted songs (avoid patterns)
			const avoidPersonaExtracts = songs
				.filter(
					(s) =>
						s.userRating === "down" &&
						s.personaExtract &&
						(s.promptEpoch ?? 0) === currentEpoch,
				)
				.map((s) => s.personaExtract as string);

			const maxOrder = songs.reduce(
				(max, s) => Math.max(max, s.orderIndex ?? 0),
				0,
			);
			const epoch = playlist.promptEpoch ?? 0;

			const previousAlbumTracks: SongMetadata[] = [];
			let completed = 0;

			for (
				let batchStart = 0;
				batchStart < TOTAL_TRACKS;
				batchStart += BATCH_SIZE
			) {
				if (abortController.signal.aborted) break;

				const batchCount = Math.min(BATCH_SIZE, TOTAL_TRACKS - batchStart);
				const batchPromises = Array.from({ length: batchCount }, (_, i) => {
					const trackNumber = batchStart + i + 1;
					return fetch("/api/autoplayer/generate-album-track", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							playlistPrompt: playlist.prompt,
							provider: playlist.llmProvider,
							model: playlist.llmModel,
							sourceSong: {
								title: sourceSong.title,
								artistName: sourceSong.artistName,
								genre: sourceSong.genre,
								subGenre: sourceSong.subGenre,
								mood: sourceSong.mood,
								energy: sourceSong.energy,
								era: sourceSong.era,
								bpm: sourceSong.bpm,
								keyScale: sourceSong.keyScale,
								vocalStyle: sourceSong.vocalStyle,
								instruments: sourceSong.instruments,
								themes: sourceSong.themes,
								description: sourceSong.description,
								lyrics: sourceSong.lyrics,
							},
							likedSongs,
							personaExtracts:
								personaExtracts.length > 0 ? personaExtracts : undefined,
							avoidPersonaExtracts:
								avoidPersonaExtracts.length > 0
									? avoidPersonaExtracts
									: undefined,
							previousAlbumTracks,
							trackNumber,
							totalTracks: TOTAL_TRACKS,
							lyricsLanguage: playlist.lyricsLanguage,
							targetKey: playlist.targetKey,
							timeSignature: playlist.timeSignature,
							audioDuration: playlist.audioDuration,
						}),
						signal: abortController.signal,
					}).then(async (res) => {
						if (!res.ok) throw new Error(await res.text());
						const metadata = (await res.json()) as SongMetadata;
						await createMetadataReady({
							playlistId,
							orderIndex: maxOrder + batchStart + i + 1,
							promptEpoch: epoch,
							title: metadata.title,
							artistName: metadata.artistName,
							genre: metadata.genre,
							subGenre: metadata.subGenre,
							lyrics: metadata.lyrics,
							caption: metadata.caption,
							coverPrompt: metadata.coverPrompt,
							bpm: metadata.bpm,
							keyScale: metadata.keyScale,
							timeSignature: metadata.timeSignature,
							audioDuration: metadata.audioDuration,
							vocalStyle: metadata.vocalStyle,
							mood: metadata.mood,
							energy: metadata.energy,
							era: metadata.era,
							instruments: metadata.instruments,
							tags: metadata.tags,
							themes: metadata.themes,
							language: metadata.language,
							description: metadata.description,
						});
						completed++;
						setAlbumProgress({ current: completed, total: TOTAL_TRACKS });
						return metadata;
					});
				});

				const results = await Promise.allSettled(batchPromises);
				for (const r of results) {
					if (r.status === "fulfilled") {
						previousAlbumTracks.push(r.value);
					}
				}
			}
		} finally {
			setAlbumGenerating(false);
			setAlbumSourceTitle(null);
			albumAbortRef.current = null;
		}
	}, [
		playlistId,
		songs,
		playlist,
		currentSongId,
		albumGenerating,
		createMetadataReady,
		settings,
		updatePersonaExtract,
	]);

	// Graceful close: stop new generations, let current song finish
	const handleClosePlaylist = useCallback(async () => {
		if (!playlistId) return;
		stopPlayback();
		await updateStatus({ id: playlistId, status: "closing" });
	}, [playlistId, updateStatus]);

	// Force close: close immediately — worker will cancel in-flight work
	const handleForceClose = useCallback(async () => {
		if (!playlistId) return;
		stopPlayback();
		await updateStatus({ id: playlistId, status: "closed" });
	}, [playlistId, updateStatus]);

	const handleSelectSong = useCallback(
		(songId: string) => {
			if (isRoomMode) {
				roomController.selectSong(songId);
				return;
			}
			const song = songs?.find((s) => s.id === songId);
			if (song?.audioUrl) {
				dismissTransition();
				setCurrentSong(songId);
				loadAndPlay(song.audioUrl);
			}
		},
		[isRoomMode, roomController, songs, loadAndPlay, dismissTransition],
	);

	const handleReorder = useCallback(
		async (songId: string, newOrderIndex: number) => {
			if (!playlistId) return;
			await reorderSong({ id: songId, newOrderIndex });
			reindexPlaylist({ playlistId });
		},
		[playlistId, reorderSong, reindexPlaylist],
	);

	// Loading state while query resolves
	if (pl && playlistByKey === undefined) {
		return (
			<div
				className="font-mono min-h-screen bg-gray-950"
				suppressHydrationWarning
			/>
		);
	}

	// No pl param or playlist not found — show creator
	if (!pl || !playlistId) {
		return (
			<PlaylistCreator
				onCreatePlaylist={handleCreatePlaylist}
				onCreatePlaylistInRoom={handleCreatePlaylistInRoom}
				onOpenSettings={() => navigate({ to: "/autoplayer/settings" })}
				onOpenLibrary={() => navigate({ to: "/autoplayer/library" })}
				onOpenOneshot={() => navigate({ to: "/autoplayer/oneshot" })}
				onOpenRooms={() => navigate({ to: "/rooms" })}
				onOpenPlaylists={() => navigate({ to: "/autoplayer/playlists" })}
			/>
		);
	}

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							INFINITUNE
						</h1>
						{isRoomMode ? (
							<Badge className="rounded-none border-2 border-green-500/60 bg-green-500/10 font-mono text-xs text-green-400">
								ROOM: {(name ?? room ?? "").toUpperCase()}
								{" // "}
								{roomRole.toUpperCase()}
							</Badge>
						) : (
							<Badge className="rounded-none border-2 border-white/40 bg-transparent font-mono text-xs text-white/60">
								V1.0
							</Badge>
						)}
					</div>
					<div className="flex items-center gap-4">
						<span className="hidden sm:inline text-xs uppercase tracking-widest text-white/30">
							{isRoomMode ? (
								<>
									{roomConnection.connected ? (
										<span className="text-green-400">CONNECTED</span>
									) : (
										<span className="text-red-500 animate-pulse">
											DISCONNECTED
										</span>
									)}
									{" | "}
									DEVICES:{roomConnection.devices.length}
									{" | "}
									QUEUE:{songs?.length ?? 0}
								</>
							) : playlist?.status === "closing" ? (
								<span className="text-yellow-500 animate-pulse">
									CLOSING — FINISHING CURRENT SONG...
								</span>
							) : (
								<>MODE:AUTO | QUEUE:{songs?.length ?? 0}</>
							)}
						</span>
						{isRoomMode && (
							<button
								type="button"
								className="font-mono text-sm font-bold uppercase text-white/60 hover:text-cyan-500 flex items-center gap-1"
								onClick={() =>
									navigate({
										to: "/autoplayer/mini",
										search: {
											room,
											role: roomRole,
											pl,
											name,
											dn,
										},
									})
								}
							>
								<Minimize2 className="h-3.5 w-3.5" />
								[MINI]
							</button>
						)}
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-green-500 flex items-center gap-1"
							onClick={() => navigate({ to: "/rooms" })}
						>
							<Radio className="h-3.5 w-3.5" />
							[ROOMS]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500 flex items-center gap-1"
							onClick={() => {
								stopPlayback();
								navigate({ to: "/autoplayer/oneshot", search: (prev) => prev });
							}}
						>
							<Zap className="h-3.5 w-3.5" />
							[ONESHOT]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-blue-500"
							onClick={() => {
								stopPlayback();
								navigate({ to: "/autoplayer/library", search: (prev) => prev });
							}}
						>
							[LIBRARY]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-cyan-500"
							onClick={() =>
								navigate({ to: "/autoplayer/queue", search: (prev) => prev })
							}
						>
							[QUEUE]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
							onClick={() =>
								navigate({ to: "/autoplayer/settings", search: (prev) => prev })
							}
						>
							[SETTINGS]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500"
							onClick={handleClosePlaylist}
						>
							[CLOSE]
						</button>
						<button
							type="button"
							className={`font-mono text-sm font-bold uppercase transition-colors ${
								forceCloseArmed
									? "text-red-500 animate-pulse"
									: "text-white/60 hover:text-red-500"
							}`}
							onClick={() => {
								if (forceCloseArmed) {
									handleForceClose();
									setForceCloseArmed(false);
								} else {
									setForceCloseArmed(true);
									setTimeout(() => setForceCloseArmed(false), 2000);
								}
							}}
						>
							{forceCloseArmed ? "[CONFIRM FORCE CLOSE]" : "[FORCE CLOSE]"}
						</button>
					</div>
				</div>
			</header>

			{/* AUTOPLAY UNLOCK BANNER (room player only) */}
			{isRoomMode && roomRole === "player" && roomPlayer.needsUnlock && (
				<div className="border-b-4 border-yellow-500/30 bg-yellow-950/40 px-6 py-4 text-center cursor-pointer hover:bg-yellow-900/40 transition-colors">
					<p className="font-mono text-sm font-black uppercase text-yellow-300 animate-pulse">
						CLICK ANYWHERE TO START AUDIO PLAYBACK
					</p>
					<p className="font-mono text-[10px] font-bold uppercase text-yellow-500/60 mt-1">
						BROWSER REQUIRES USER INTERACTION BEFORE PLAYING AUDIO
					</p>
				</div>
			)}

			{/* NOW PLAYING / DEVICE CONTROL + RIGHT PANEL */}
			<div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] border-b-4 border-white/20">
				<div className="border-b-4 md:border-b-0 md:border-r-4 border-white/20">
					{isRoomMode && roomRole === "controller" ? (
						<DeviceControlPanel
							devices={roomConnection.devices}
							playback={roomConnection.playback}
							currentSong={roomConnection.currentSong}
							onToggle={toggle}
							onSkip={skipToNext}
							onRate={
								currentSongId
									? (rating) => rateSong(currentSongId, rating)
									: undefined
							}
							onSetVolume={roomController.setVolume}
							onSetDeviceVolume={roomController.setDeviceVolume}
							onToggleDevicePlay={roomController.toggleDevicePlay}
							onSyncAll={roomController.syncAll}
							onRenameDevice={roomController.renameDevice}
							onResetDeviceToDefault={roomController.resetDeviceToDefault}
							onSeek={roomController.seek}
						/>
					) : (
						<NowPlaying
							song={currentSong}
							onToggle={toggle}
							onSkip={skipToNext}
							onSeek={seek}
							onRate={(rating) => {
								if (currentSongId) {
									rateSong(currentSongId, rating);
								}
							}}
							{...(isRoomMode
								? {
										playbackOverride: {
											isPlaying: roomConnection.playback.isPlaying,
											currentTime: roomConnection.playback.currentTime,
											duration: roomConnection.playback.duration,
											volume: roomConnection.playback.volume,
											isMuted: roomConnection.playback.isMuted,
										},
										onSetVolume: roomController.setVolume,
										onToggleMute: roomController.toggleMute,
									}
								: {})}
						/>
					)}
				</div>
				<div className="flex flex-col bg-gray-950 overflow-y-auto">
					{playlist && <GenerationControls playlist={playlist} />}
					{playlist && (
						<DirectionSteering
							playlist={playlist}
							disabled={playlist.status !== "active"}
						/>
					)}
					<QuickRequest
						onRequest={requestSong}
						disabled={!playlist || playlist.status !== "active"}
						provider={playlist?.llmProvider as LlmProvider | undefined}
						model={playlist?.llmModel}
					/>
					{/* Action buttons */}
					<div className="flex gap-3 px-6 pb-6">
						{(() => {
							const albumEnabled =
								!!currentSongId && !!currentSong?.title && !albumGenerating;
							return (
								<Button
									className={`flex-1 h-10 rounded-none border-2 font-mono text-xs font-black uppercase transition-colors ${
										albumGenerating
											? "border-purple-500 bg-purple-500/20 text-purple-300 animate-pulse"
											: albumEnabled
												? "border-purple-500/60 bg-transparent text-purple-400 hover:bg-purple-500 hover:text-white"
												: "border-white/20 bg-transparent text-white/30 cursor-not-allowed"
									}`}
									disabled={!albumEnabled}
									onClick={handleAddAlbum}
								>
									<Disc3
										className={`h-3.5 w-3.5 mr-1.5 ${albumGenerating ? "animate-spin" : ""}`}
									/>
									{albumGenerating
										? albumProgress.current === 0
											? "STARTING ALBUM..."
											: `ALBUM ${albumProgress.current}/${albumProgress.total}`
										: "ADD ALBUM"}
								</Button>
							);
						})()}
						<Button
							className="flex-1 h-10 rounded-none border-2 border-white/20 bg-red-500 font-mono text-xs font-black uppercase text-white hover:bg-white hover:text-black hover:border-white"
							onClick={handleAddBatch}
							disabled={!playlistId || !songs}
						>
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							ADD 5 MORE
						</Button>
					</div>
				</div>
			</div>

			{/* ALBUM PROGRESS BANNER */}
			{albumGenerating && (
				<div className="border-b-4 border-purple-500/30 bg-purple-950/40 px-6 py-3">
					<div className="flex items-center justify-between mb-2">
						<span className="font-mono text-xs font-black uppercase text-purple-300 flex items-center gap-2">
							<Disc3 className="h-3.5 w-3.5 animate-spin" />
							GENERATING ALBUM FROM{" "}
							{albumSourceTitle ? `"${albumSourceTitle}"` : "..."}
						</span>
						<span className="font-mono text-xs font-bold uppercase text-purple-400">
							{albumProgress.current} / {albumProgress.total} TRACKS
						</span>
					</div>
					<div className="h-2 w-full bg-purple-900/50 overflow-hidden">
						<div
							className="h-full bg-purple-500 transition-all duration-300"
							style={{
								width: `${albumProgress.total > 0 ? (albumProgress.current / albumProgress.total) * 100 : 0}%`,
							}}
						/>
					</div>
				</div>
			)}

			{/* GENERATION BANNER */}
			{songs && <GenerationBanner songs={songs} />}

			{/* UP NEXT BANNER */}
			{songs && playlist && (
				<UpNextBanner
					songs={songs}
					currentSongId={currentSongId}
					playlist={playlist}
					transitionComplete={transitionComplete}
				/>
			)}

			{/* QUEUE GRID */}
			{songs && songs.length > 0 && (
				<QueueGrid
					songs={songs}
					currentSongId={currentSongId}
					playlistEpoch={playlistEpoch}
					transitionComplete={transitionComplete}
					onSelectSong={handleSelectSong}
					onOpenDetail={setDetailSongId}
					onRate={rateSong}
					onReorder={handleReorder}
				/>
			)}

			{/* FOOTER */}
			<footer className="bg-black px-4 py-2 border-t border-white/10">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span>{"INFINITUNE V1.0 // INFINITE GENERATIVE MUSIC"}</span>
					<span className="flex items-center gap-3">
						<EndpointDot label="LLM" status={workerStatus?.queues.llm} />
						<EndpointDot label="IMG" status={workerStatus?.queues.image} />
						<EndpointDot label="AUD" status={workerStatus?.queues.audio} />
					</span>
					<span className="flex items-center gap-2">
						<VinylIcon size={12} />
						{songs?.length ?? 0} {"TRACKS // "}
						{songs?.filter((s) => s.status === "ready" || s.status === "played")
							.length ?? 0}{" "}
						{"READY"}
					</span>
					<span className="animate-pulse text-red-500">[LIVE]</span>
				</div>
			</footer>

			{/* TRACK DETAIL */}
			{detailSongId &&
				songs &&
				(() => {
					const detailSong = songs.find((s) => s.id === detailSongId);
					if (!detailSong) return null;
					return (
						<TrackDetail
							song={detailSong}
							onClose={() => setDetailSongId(null)}
						/>
					);
				})()}
		</div>
	);
}
