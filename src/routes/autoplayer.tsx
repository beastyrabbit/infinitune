import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMutation, useQuery } from "convex/react";
import { Music } from "lucide-react";
import { useCallback, useState } from "react";
import { GenerationBanner } from "@/components/autoplayer/GenerationBanner";
import { GenerationControls } from "@/components/autoplayer/GenerationControls";
import { NowPlaying } from "@/components/autoplayer/NowPlaying";
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

	const createSession = useMutation(api.sessions.create);
	const updateStatus = useMutation(api.sessions.updateStatus);
	const updateSongStatus = useMutation(api.songs.updateStatus);
	const revertTransientStatuses = useMutation(api.songs.revertTransientStatuses);

	const {
		songs,
		session,
		toggle,
		seek,
		skipToNext,
		requestSong,
		loadAndPlay,
	} = useAutoplayer(sessionId);

	const { currentSongId } = useStore(playerStore);

	useVolumeSync();

	const currentSong = songs?.find((s) => s._id === currentSongId) ?? null;

	const handleCreateSession = useCallback(
		async (data: {
			name: string;
			prompt: string;
			provider: string;
			model: string;
			lyricsLanguage?: string;
			targetBpm?: number;
			targetKey?: string;
			timeSignature?: string;
			audioDuration?: number;
			inferenceSteps?: number;
		}) => {
			await createSession({
				name: data.name,
				prompt: data.prompt,
				llmProvider: data.provider,
				llmModel: data.model,
				lyricsLanguage: data.lyricsLanguage,
				targetBpm: data.targetBpm,
				targetKey: data.targetKey,
				timeSignature: data.timeSignature,
				audioDuration: data.audioDuration,
				inferenceSteps: data.inferenceSteps,
			});
		},
		[createSession],
	);

	// Graceful close: stop new generations, let current song finish
	const handleCloseSession = useCallback(async () => {
		if (!sessionId) return;
		await updateStatus({ id: sessionId as any, status: "closing" });
	}, [sessionId, updateStatus]);

	// Force close: revert transient statuses and close immediately
	const handleForceClose = useCallback(async () => {
		if (!sessionId) return;
		await revertTransientStatuses({ sessionId: sessionId as any });
		await updateStatus({ id: sessionId as any, status: "closed" });
	}, [sessionId, updateStatus, revertTransientStatuses]);

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
				updateSongStatus({ id: songId as any, status: "playing" });
				loadAndPlay(song.audioUrl);
			}
		},
		[songs, loadAndPlay, updateSongStatus],
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
				{session && <GenerationControls session={session} />}
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

			{/* QUICK REQUEST */}
			<div className="border-b-4 border-white/20">
				<QuickRequest
					onRequest={requestSong}
					disabled={!session || session.status !== "active"}
				/>
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
