import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
	AlertTriangle,
	ArrowLeft,
	Download,
	Pause,
	Play,
	RefreshCw,
	Volume2,
	VolumeX,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useOneshot } from "@/hooks/useOneshot";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import { useVolumeSync } from "@/hooks/useVolumeSync";
import {
	useCreateRawOneshot,
	usePlaylistByKey,
} from "@/integrations/api/hooks";
import { formatTime } from "@/lib/format-time";
import {
	getGlobalAudio,
	playerStore,
	setCurrentSong,
	setDuration,
	setPlaying,
	setVolume,
	toggleMute,
} from "@/lib/player-store";
import {
	generatePlaylistKey,
	validatePlaylistKeySearch,
} from "@/lib/playlist-key";
import { STATUS_PROGRESS_TEXT } from "@/lib/song-status";

export const Route = createFileRoute("/autoplayer_/oneshot")({
	component: RawOneshotPage,
	validateSearch: validatePlaylistKeySearch,
});

const DURATION_OPTIONS = [
	{ value: "60", label: "1:00" },
	{ value: "120", label: "2:00" },
	{ value: "180", label: "3:00" },
	{ value: "240", label: "4:00" },
] as const;

const GENERATE_LABEL = "»»» SEND TO ACE-STEP «««";
const GENERATE_ANOTHER_LABEL = "»»» GENERATE ANOTHER «««";

function RawOneshotPage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const createRawOneshot = useCreateRawOneshot();

	// Restore an in-flight generation from the URL key
	const playlistByKey = usePlaylistByKey(pl ?? null);
	const playlistIdFromUrl = playlistByKey?.id ?? null;
	const [localPlaylistId, setLocalPlaylistId] = useState<string | null>(null);
	const playlistId = playlistIdFromUrl ?? localPlaylistId;

	const [lyrics, setLyrics] = useState("");
	const [style, setStyle] = useState("");
	const [duration, setDurationChoice] = useState("180");
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const { song, phase } = useOneshot(playlistId);
	const { loadAndPlay, toggle, seek } = useAudioPlayer();
	const {
		isPlaying,
		currentTime,
		duration: audioDuration,
		volume,
		isMuted,
	} = useStore(playerStore);
	useVolumeSync();
	usePlaylistHeartbeat(playlistId);

	// Auto-play once the song is ready
	const hasAutoPlayed = useRef(false);
	useEffect(() => {
		if (phase === "ready" && song?.audioUrl && !hasAutoPlayed.current) {
			hasAutoPlayed.current = true;
			setCurrentSong(song.id);
			loadAndPlay(song.audioUrl);
		}
	}, [phase, song, loadAndPlay]);

	const generating =
		submitting || phase === "creating" || phase === "generating";

	const handleGenerate = useCallback(async () => {
		if (!lyrics.trim() || generating) return;
		setSubmitting(true);
		setSubmitError(null);
		hasAutoPlayed.current = false;

		try {
			const playlistKey = generatePlaylistKey();
			const result = await createRawOneshot({
				lyrics: lyrics.trim(),
				style: style.trim(),
				audioDuration: Number.parseInt(duration, 10),
				playlistKey,
			});
			setLocalPlaylistId(result.playlist.id);
			navigate({ to: "/autoplayer/oneshot", search: { pl: playlistKey } });
		} catch (error) {
			setSubmitError(
				error instanceof Error ? error.message : "Submission failed",
			);
		} finally {
			setSubmitting(false);
		}
	}, [lyrics, style, duration, generating, createRawOneshot, navigate]);

	const handleGenerateAnother = useCallback(() => {
		setLocalPlaylistId(null);
		setSubmitError(null);
		hasAutoPlayed.current = false;
		navigate({ to: "/autoplayer/oneshot", search: {} });
	}, [navigate]);

	const handlePlayPause = useCallback(() => {
		if (!song?.audioUrl) return;
		const audio = getGlobalAudio();
		if (!audio.src || playerStore.state.currentSongId !== song.id) {
			setCurrentSong(song.id);
			audio.src = song.audioUrl;
			audio.load();
			audio
				.play()
				.then(() => setPlaying(true))
				.catch(() => {});
			if (audio.duration && !Number.isNaN(audio.duration))
				setDuration(audio.duration);
		} else {
			toggle();
		}
	}, [song, toggle]);

	const handleSeek = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!audioDuration) return;
			const rect = e.currentTarget.getBoundingClientRect();
			const pct = Math.max(
				0,
				Math.min(1, (e.clientX - rect.left) / rect.width),
			);
			seek(pct * audioDuration);
		},
		[audioDuration, seek],
	);

	const isCurrentSong = song && playerStore.state.currentSongId === song.id;
	const showOutput = phase !== "idle" || submitting;
	const progress =
		audioDuration > 0 && isCurrentSong
			? (currentTime / audioDuration) * 100
			: 0;

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex flex-col">
			{/* ═══ HEADER ═══ */}
			<header className="border-b-4 border-yellow-500/30 bg-black shrink-0">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<button
							type="button"
							className="text-white/60 hover:text-white transition-colors"
							onClick={() => navigate({ to: "/autoplayer" })}
						>
							<ArrowLeft className="h-5 w-5" />
						</button>
						<div className="flex items-center gap-3">
							<Zap className="h-5 w-5 text-yellow-500" />
							<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
								RAW ONESHOT
							</h1>
						</div>
					</div>
					<button
						type="button"
						className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
						onClick={() =>
							navigate({ to: "/autoplayer/settings", search: (prev) => prev })
						}
					>
						[SETTINGS]
					</button>
				</div>
				<p className="px-4 pb-3 text-[10px] font-bold uppercase tracking-widest text-yellow-500/50">
					NO AI PROCESSING — YOUR TEXT GOES STRAIGHT INTO ACE-STEP
				</p>
			</header>

			{/* ═══ MAIN ═══ */}
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-3xl mx-auto p-4 sm:p-6">
					{/* ─── INPUT ─── */}
					<div className="border-4 border-yellow-500/20 bg-black">
						<div className="border-b-4 border-yellow-500/20 px-4 py-3 flex items-center gap-2">
							<Zap className="h-4 w-4 text-yellow-500" />
							<span className="text-sm font-black uppercase tracking-widest">
								LYRICS &amp; STYLE
							</span>
						</div>

						<div className="p-6 space-y-5">
							<div>
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									LYRICS — SENT VERBATIM
								</p>
								<Textarea
									className="min-h-[220px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-yellow-500/50 resize-y"
									placeholder={
										"[verse]\nYour lyrics here, exactly as ACE should sing them\n\n[chorus]\nSection tags like [verse] and [chorus] are supported"
									}
									value={lyrics}
									onChange={(e) => setLyrics(e.target.value)}
									disabled={generating}
								/>
							</div>

							<div>
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									STYLE TAGS — ACE PROMPT (COMMA-SEPARATED)
								</p>
								<Textarea
									className="min-h-[60px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-yellow-500/50 resize-y"
									placeholder="synthwave, driving bass, female vocal, anthemic chorus"
									value={style}
									onChange={(e) => setStyle(e.target.value)}
									disabled={generating}
								/>
							</div>

							<div className="max-w-[200px]">
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									DURATION
								</p>
								<Select
									value={duration}
									onValueChange={setDurationChoice}
									disabled={generating}
								>
									<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
										<SelectValue />
									</SelectTrigger>
									<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
										{DURATION_OPTIONS.map((opt) => (
											<SelectItem
												key={opt.value}
												value={opt.value}
												className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
											>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{submitError && (
								<p className="text-xs font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
									{submitError}
								</p>
							)}

							<Button
								className="w-full h-14 rounded-none border-4 border-yellow-500/30 bg-yellow-500 font-mono text-lg font-black uppercase text-black hover:bg-white hover:text-black hover:border-white disabled:opacity-30 disabled:hover:bg-yellow-500 disabled:hover:border-yellow-500/30"
								onClick={handleGenerate}
								disabled={!lyrics.trim() || generating}
							>
								{generating ? (
									<span className="flex items-center gap-2">
										<Zap className="h-5 w-5 animate-pulse" />
										GENERATING...
									</span>
								) : (
									GENERATE_LABEL
								)}
							</Button>
						</div>
					</div>

					{/* ─── OUTPUT ─── */}
					{showOutput && (
						<div className="border-4 border-t-0 border-yellow-500/20 bg-black">
							{(phase === "creating" || phase === "generating") && (
								<div className="p-6 flex items-center gap-3">
									<Zap className="h-5 w-5 text-yellow-500 animate-pulse" />
									<span className="text-sm font-black uppercase tracking-widest text-yellow-500/80">
										{(song?.status && STATUS_PROGRESS_TEXT[song.status]) ||
											"SUBMITTING..."}
									</span>
								</div>
							)}

							{phase === "error" && (
								<div className="p-6">
									<div className="flex items-center gap-3 text-red-500 mb-3">
										<AlertTriangle className="h-5 w-5" />
										<span className="text-sm font-black uppercase tracking-widest">
											GENERATION FAILED
										</span>
									</div>
									{song?.errorMessage && (
										<p className="text-xs font-bold uppercase text-white/40 mb-4">
											{song.errorMessage}
										</p>
									)}
									<Button
										className="w-full h-12 rounded-none border-4 border-yellow-500/30 bg-yellow-500 font-mono text-base font-black uppercase text-black hover:bg-white"
										onClick={handleGenerateAnother}
									>
										<RefreshCw className="h-4 w-4 mr-2" />
										{">>> TRY AGAIN <<<"}
									</Button>
								</div>
							)}

							{phase === "ready" && song && (
								<div>
									<div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] border-b-4 border-white/10">
										<div className="border-b-4 sm:border-b-0 sm:border-r-4 border-white/10">
											<CoverArt
												title={song.title || "UNTITLED"}
												artistName={song.artistName || "ONESHOT"}
												cover={song.cover}
												size="md"
												spinning={!!isCurrentSong && isPlaying}
											/>
										</div>

										<div className="flex flex-col">
											<div className="p-4 border-b-2 border-white/10 flex-1">
												<h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight">
													{song.title || "UNTITLED"}
												</h2>
												<p className="text-sm font-bold uppercase text-white/50 mt-1">
													{song.caption || "RAW ONESHOT"}
												</p>
											</div>

											<div className="p-4 space-y-3">
												<div className="flex items-center gap-3">
													<button
														type="button"
														className="shrink-0 h-10 w-10 border-2 border-yellow-500 flex items-center justify-center text-yellow-500 hover:bg-yellow-500 hover:text-black transition-colors"
														onClick={handlePlayPause}
													>
														{isCurrentSong && isPlaying ? (
															<Pause className="h-4 w-4" />
														) : (
															<Play className="h-4 w-4" />
														)}
													</button>

													<div className="flex-1 flex items-center gap-2">
														<span className="text-[10px] font-bold text-white/40 shrink-0 w-8 text-right">
															{isCurrentSong ? formatTime(currentTime) : "0:00"}
														</span>
														{/* biome-ignore lint/a11y/useSemanticElements: div used for custom seek bar */}
														<div
															role="button"
															tabIndex={0}
															className="flex-1 h-2 border-2 border-white/20 bg-black cursor-pointer"
															onClick={handleSeek}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ") {
																	e.preventDefault();
																}
															}}
														>
															<div
																className="h-full bg-yellow-500 transition-all"
																style={{ width: `${progress}%` }}
															/>
														</div>
														<span className="text-[10px] font-bold text-white/40 shrink-0 w-8">
															{isCurrentSong && audioDuration > 0
																? formatTime(audioDuration)
																: "--:--"}
														</span>
													</div>
												</div>

												<div className="flex items-center justify-between">
													<div className="flex items-center gap-2">
														<button
															type="button"
															onClick={toggleMute}
															className="text-white/50 hover:text-white transition-colors"
														>
															{isMuted ? (
																<VolumeX className="h-3.5 w-3.5" />
															) : (
																<Volume2 className="h-3.5 w-3.5" />
															)}
														</button>
														{/* biome-ignore lint/a11y/useSemanticElements: div used for custom volume bar */}
														<div
															role="button"
															tabIndex={0}
															className="h-1.5 w-16 border border-white/20 bg-black cursor-pointer"
															onClick={(e) => {
																const rect =
																	e.currentTarget.getBoundingClientRect();
																const pct = Math.max(
																	0,
																	Math.min(
																		1,
																		(e.clientX - rect.left) / rect.width,
																	),
																);
																setVolume(pct);
															}}
															onKeyDown={(e) => {
																if (e.key === "Enter" || e.key === " ")
																	e.preventDefault();
															}}
														>
															<div
																className="h-full bg-white"
																style={{
																	width: `${(isMuted ? 0 : volume) * 100}%`,
																}}
															/>
														</div>
													</div>

													{song.audioUrl && (
														<a
															href={song.audioUrl}
															download={`${song.title || "oneshot"}.mp3`}
															className="flex items-center gap-1 text-xs font-bold uppercase text-white/40 hover:text-yellow-500 transition-colors"
														>
															<Download className="h-3.5 w-3.5" />
															DOWNLOAD
														</a>
													)}
												</div>
											</div>
										</div>
									</div>

									<div className="p-4">
										<Button
											className="w-full h-12 rounded-none border-4 border-yellow-500/30 bg-transparent font-mono text-base font-black uppercase text-yellow-500 hover:bg-yellow-500 hover:text-black hover:border-yellow-500"
											onClick={handleGenerateAnother}
										>
											<RefreshCw className="h-4 w-4 mr-2" />
											{GENERATE_ANOTHER_LABEL}
										</Button>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			</main>

			{/* ═══ FOOTER ═══ */}
			<footer className="bg-black px-4 py-2 border-t-4 border-yellow-500/20 shrink-0">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span className="flex items-center gap-2">
						<Zap className="h-3 w-3 text-yellow-500/60" />
						RAW ONESHOT {"//"} TEXT → ACE-STEP, NO LLM
					</span>
					<span className="text-yellow-500/40">
						{phase === "idle"
							? "READY"
							: phase === "ready"
								? "COMPLETE"
								: phase.toUpperCase()}
					</span>
				</div>
			</footer>
		</div>
	);
}
