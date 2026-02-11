import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMutation, useQuery } from "convex/react";
import { Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { DirectionSteering } from "@/components/autoplayer/DirectionSteering";
import { GenerationBanner } from "@/components/autoplayer/GenerationBanner";
import { GenerationControls } from "@/components/autoplayer/GenerationControls";
import { NowPlaying } from "@/components/autoplayer/NowPlaying";
import { PlaylistCreator } from "@/components/autoplayer/PlaylistCreator";
import { PlaylistPicker } from "@/components/autoplayer/PlaylistPicker";
import { QueueGrid } from "@/components/autoplayer/QueueGrid";
import { QuickRequest } from "@/components/autoplayer/QuickRequest";
import { TrackDetail } from "@/components/autoplayer/TrackDetail";
import { Badge } from "@/components/ui/badge";
import VinylIcon from "@/components/ui/vinyl-icon";
import { useAutoplayer } from "@/hooks/useAutoplayer";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import { useVolumeSync } from "@/hooks/useVolumeSync";
import type { EndpointStatus } from "@/hooks/useWorkerStatus";
import { useWorkerStatus } from "@/hooks/useWorkerStatus";
import { playerStore, setCurrentSong } from "@/lib/player-store";
import {
	generatePlaylistKey,
	validatePlaylistKeySearch,
} from "@/lib/playlist-key";
import { api } from "../../convex/_generated/api";
import type { LlmProvider } from "../../convex/types";

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
	const { pl } = Route.useSearch();
	const [detailSongId, setDetailSongId] = useState<string | null>(null);
	const [forceCloseArmed, setForceCloseArmed] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);

	// Look up playlist by key from URL
	const playlistByKey = useQuery(
		api.playlists.getByPlaylistKey,
		pl ? { playlistKey: pl } : "skip",
	);
	const playlistId = playlistByKey?._id ?? null;

	const createPlaylist = useMutation(api.playlists.create);
	const updateStatus = useMutation(api.playlists.updateStatus);
	// revertTransientStatuses is no longer needed — the worker handles recovery on restart

	const {
		songs,
		playlist,
		toggle,
		seek,
		skipToNext,
		requestSong,
		loadAndPlay,
		rateSong,
	} = useAutoplayer(playlistId);

	const { currentSongId } = useStore(playerStore);

	useVolumeSync();
	usePlaylistHeartbeat(playlistId);
	const { status: workerStatus } = useWorkerStatus();

	const currentSong = songs?.find((s) => s._id === currentSongId) ?? null;

	const handleCreatePlaylist = useCallback(
		async (data: {
			name: string;
			prompt: string;
			provider: LlmProvider;
			model: string;
			lyricsLanguage?: string;
			targetBpm?: number;
			targetKey?: string;
			timeSignature?: string;
			audioDuration?: number;
			inferenceSteps?: number;
		}) => {
			const key = generatePlaylistKey();
			await createPlaylist({
				name: data.name,
				prompt: data.prompt,
				llmProvider: data.provider,
				llmModel: data.model,
				playlistKey: key,
				lyricsLanguage: data.lyricsLanguage,
				targetBpm: data.targetBpm,
				targetKey: data.targetKey,
				timeSignature: data.timeSignature,
				audioDuration: data.audioDuration,
				inferenceSteps: data.inferenceSteps,
			});
			navigate({
				to: "/autoplayer",
				search: { pl: key },
			});
		},
		[createPlaylist, navigate],
	);

	// Graceful close: stop new generations, let current song finish
	const handleClosePlaylist = useCallback(async () => {
		if (!playlistId) return;
		await updateStatus({ id: playlistId, status: "closing" });
	}, [playlistId, updateStatus]);

	// Force close: close immediately — worker will cancel in-flight work
	const handleForceClose = useCallback(async () => {
		if (!playlistId) return;
		await updateStatus({ id: playlistId, status: "closed" });
	}, [playlistId, updateStatus]);

	const handleSelectSong = useCallback(
		(songId: string) => {
			const song = songs?.find((s) => s._id === songId);
			if (song?.audioUrl) {
				setCurrentSong(songId);
				loadAndPlay(song.audioUrl);
			}
		},
		[songs, loadAndPlay],
	);

	// Loading state while Convex query resolves
	if (pl && playlistByKey === undefined) {
		return <div className="font-mono min-h-screen bg-gray-950" />;
	}

	// No pl param or playlist not found — show creator + picker
	if (!pl || !playlistId) {
		return (
			<>
				<PlaylistCreator
					onCreatePlaylist={handleCreatePlaylist}
					onOpenSettings={() => navigate({ to: "/autoplayer/settings" })}
					onOpenLibrary={() => navigate({ to: "/autoplayer/library" })}
					onOpenOneshot={() => navigate({ to: "/autoplayer/oneshot" })}
					onOpenPlaylists={() => setPickerOpen(true)}
				/>
				{pickerOpen && (
					<PlaylistPicker
						onSelect={(key) => {
							setPickerOpen(false);
							navigate({ to: "/autoplayer", search: { pl: key } });
						}}
						onClose={() => setPickerOpen(false)}
					/>
				)}
			</>
		);
	}

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							AUTOPLAYER
						</h1>
						<Badge className="rounded-none border-2 border-white/40 bg-transparent font-mono text-xs text-white/60">
							V1.0
						</Badge>
					</div>
					<div className="flex items-center gap-4">
						<span className="hidden sm:inline text-xs uppercase tracking-widest text-white/30">
							{playlist?.status === "closing" ? (
								<span className="text-yellow-500 animate-pulse">
									CLOSING — FINISHING CURRENT SONG...
								</span>
							) : (
								<>MODE:AUTO | QUEUE:{songs?.length ?? 0}</>
							)}
						</span>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500 flex items-center gap-1"
							onClick={() =>
								navigate({ to: "/autoplayer/oneshot", search: (prev) => prev })
							}
						>
							<Zap className="h-3.5 w-3.5" />
							[ONESHOT]
						</button>
						<button
							type="button"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-blue-500"
							onClick={() =>
								navigate({ to: "/autoplayer/library", search: (prev) => prev })
							}
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

			{/* NOW PLAYING + GENERATION CONTROLS */}
			<div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] border-b-4 border-white/20">
				<div className="border-b-4 md:border-b-0 md:border-r-4 border-white/20">
					<NowPlaying
						song={currentSong}
						onToggle={toggle}
						onSkip={skipToNext}
						onSeek={seek}
						onRate={(rating) => {
							if (currentSongId) rateSong(currentSongId, rating);
						}}
					/>
				</div>
				{playlist && <GenerationControls playlist={playlist} />}
			</div>

			{/* GENERATION BANNER */}
			{songs && <GenerationBanner songs={songs} />}

			{/* QUEUE GRID */}
			{songs && songs.length > 0 && (
				<QueueGrid
					songs={songs}
					currentSongId={currentSongId}
					onSelectSong={handleSelectSong}
					onOpenDetail={setDetailSongId}
					onRate={rateSong}
				/>
			)}

			{/* DIRECTION STEERING + QUICK REQUEST */}
			<div className="border-b-4 border-white/20">
				{playlist && (
					<DirectionSteering
						playlist={playlist}
						disabled={playlist.status !== "active"}
					/>
				)}
				<QuickRequest
					onRequest={requestSong}
					disabled={!playlist || playlist.status !== "active"}
					provider={playlist?.llmProvider}
					model={playlist?.llmModel}
				/>
			</div>

			{/* FOOTER */}
			<footer className="bg-black px-4 py-2 border-t border-white/10">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span>{"AUTOPLAYER V1.0 // BRUTALIST INTERFACE"}</span>
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
					const detailSong = songs.find((s) => s._id === detailSongId);
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
