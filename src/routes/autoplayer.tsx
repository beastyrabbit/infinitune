import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMutation, useQuery } from "convex/react";
import { Music } from "lucide-react";
import { useCallback, useState } from "react";
import { GenerationBanner } from "@/components/autoplayer/GenerationBanner";
import { GenerationControls } from "@/components/autoplayer/GenerationControls";
import { NowPlaying } from "@/components/autoplayer/NowPlaying";
import { PlaylistConfig } from "@/components/autoplayer/PlaylistConfig";
import { QueueGrid } from "@/components/autoplayer/QueueGrid";
import { QuickRequest } from "@/components/autoplayer/QuickRequest";
import { SessionCreator } from "@/components/autoplayer/SessionCreator";
import { TrackDetail } from "@/components/autoplayer/TrackDetail";
import { Badge } from "@/components/ui/badge";
import { useAutoplayer } from "@/hooks/useAutoplayer";
import { useVolumeSync } from "@/hooks/useVolumeSync";
import { playerStore, setCurrentSong } from "@/lib/player-store";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/autoplayer")({
	component: AutoplayerPage,
});

function AutoplayerPage() {
	const navigate = useNavigate();
	const [detailSongId, setDetailSongId] = useState<string | null>(null);
	const [forceCloseArmed, setForceCloseArmed] = useState(false);

	const currentSession = useQuery(api.sessions.getCurrent);
	const sessionId = currentSession?._id ?? null;

	const settings = useQuery(api.settings.getAll);
	const createSession = useMutation(api.sessions.create);
	const updatePrompt = useMutation(api.sessions.updatePrompt);
	const updateStatus = useMutation(api.sessions.updateStatus);

	const rawImageProvider = settings?.imageProvider;
	const modelSettings = {
		imageProvider: rawImageProvider === "ollama" ? "comfyui" : rawImageProvider,
		imageModel: settings?.imageModel,
		aceModel: settings?.aceModel,
	};

	const cancelAllGenerating = useMutation(api.songs.cancelAllGenerating);

	const {
		songs,
		session,
		toggle,
		seek,
		skipToNext,
		requestSong,
		loadAndPlay,
		abortGeneration,
	} = useAutoplayer(sessionId, modelSettings);

	const { currentSongId } = useStore(playerStore);

	useVolumeSync();

	const currentSong = songs?.find((s) => s._id === currentSongId) ?? null;

	const handleCreateSession = useCallback(
		async (data: {
			name: string;
			prompt: string;
			provider: string;
			model: string;
		}) => {
			await createSession({
				name: data.name,
				prompt: data.prompt,
				llmProvider: data.provider,
				llmModel: data.model,
			});
		},
		[createSession],
	);

	const handleUpdatePrompt = useCallback(
		async (prompt: string) => {
			if (!sessionId) return;
			await updatePrompt({ id: sessionId as any, prompt });
		},
		[sessionId, updatePrompt],
	);

	// Graceful close: stop new generations, let current song finish
	const handleCloseSession = useCallback(async () => {
		if (!sessionId) return;
		// Set to 'closing' — pipeline won't start new generations
		// Currently running pipeline will finish its current song
		await updateStatus({ id: sessionId as any, status: "closing" });
	}, [sessionId, updateStatus]);

	// Force close: cancel everything immediately
	const handleForceClose = useCallback(async () => {
		if (!sessionId) return;
		// Abort the client-side pipeline
		abortGeneration();
		// Mark all in-progress songs as cancelled in the DB
		await cancelAllGenerating({ sessionId: sessionId as any });
		// Close the session
		await updateStatus({ id: sessionId as any, status: "closed" });
	}, [sessionId, updateStatus, abortGeneration, cancelAllGenerating]);

	const handleResumeSession = useCallback(
		async (id: string) => {
			await updateStatus({ id: id as any, status: "active" });
		},
		[updateStatus],
	);

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
	if (currentSession === undefined) {
		return <div className="font-mono min-h-screen bg-gray-950" />;
	}

	// No active session — show creator with session history
	if (!sessionId) {
		return (
			<SessionCreator
				onCreateSession={handleCreateSession}
				onResumeSession={handleResumeSession}
				onOpenSettings={() => navigate({ to: "/autoplayer/settings" })}
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
							AUTOPLAYER
						</h1>
						<Badge className="rounded-none border-2 border-white/40 bg-transparent font-mono text-xs text-white/60">
							V1.0
						</Badge>
					</div>
					<div className="flex items-center gap-4">
						<span className="hidden sm:inline text-xs uppercase tracking-widest text-white/30">
							{session?.status === "closing" ? (
								<span className="text-yellow-500 animate-pulse">
									CLOSING — FINISHING CURRENT SONG...
								</span>
							) : (
								<>MODE:AUTO | QUEUE:{songs?.length ?? 0}</>
							)}
						</span>
						<button
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
							onClick={() => navigate({ to: "/autoplayer/settings" })}
						>
							[SETTINGS]
						</button>
						<button
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500"
							onClick={handleCloseSession}
						>
							[CLOSE]
						</button>
						<button
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
									// Auto-disarm after 2 seconds
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
						song={currentSong as any}
						onToggle={toggle}
						onSkip={skipToNext}
						onSeek={seek}
					/>
				</div>
				<GenerationControls />
			</div>

			{/* GENERATION BANNER */}
			{songs && <GenerationBanner songs={songs as any} />}

			{/* QUEUE GRID */}
			{songs && songs.length > 0 && (
				<QueueGrid
					songs={songs as any}
					currentSongId={currentSongId}
					onSelectSong={handleSelectSong}
					onOpenDetail={setDetailSongId}
				/>
			)}

			{/* QUICK REQUEST + PLAYLIST CONFIG */}
			<div className="grid grid-cols-1 md:grid-cols-2 border-b-4 border-white/20">
				<div className="border-b-4 md:border-b-0 md:border-r-4 border-white/20">
					<QuickRequest
						onRequest={requestSong}
						disabled={!session || session.status !== "active"}
					/>
				</div>
				{session && (
					<PlaylistConfig
						prompt={session.prompt}
						provider={session.llmProvider}
						model={session.llmModel}
						onUpdatePrompt={handleUpdatePrompt}
					/>
				)}
			</div>

			{/* FOOTER */}
			<footer className="bg-black px-4 py-2 border-t border-white/10">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span>AUTOPLAYER V1.0 // BRUTALIST INTERFACE</span>
					<span className="flex items-center gap-2">
						<Music className="h-3 w-3" />
						{songs?.filter((s) => s.status !== "played").length ?? 0} TRACKS IN
						PIPELINE
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
							song={detailSong as any}
							onClose={() => setDetailSongId(null)}
						/>
					);
				})()}
		</div>
	);
}
