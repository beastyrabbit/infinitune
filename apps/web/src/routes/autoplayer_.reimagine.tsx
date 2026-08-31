import type { Song } from "@infinitune/shared/types";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
	AlertTriangle,
	ArrowLeft,
	Download,
	Pause,
	Play,
	RefreshCw,
	Sparkles,
	Volume2,
	VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useOneshot } from "@/hooks/useOneshot";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import { useVolumeSync } from "@/hooks/useVolumeSync";
import { api } from "@/integrations/api/client";
import {
	usePlaylistByKey,
	useReimagineFromUrl,
	useReimagineSong,
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

export const Route = createFileRoute("/autoplayer_/reimagine")({
	component: ReimaginePage,
	validateSearch: validatePlaylistKeySearch,
});

const FIDELITY_OPTIONS = [
	{ value: 0.3, label: "LOOSE", hint: "NEW TAKE, FAINT ECHO OF THE ORIGINAL" },
	{ value: 0.5, label: "BALANCED", hint: "RECOGNIZABLE SONG, NEW SOUND" },
	{ value: 0.7, label: "CLOSE", hint: "STAYS NEAR THE ORIGINAL STRUCTURE" },
	{ value: 0.85, label: "FAITHFUL", hint: "MINIMAL DEPARTURE FROM SOURCE" },
] as const;

const GENERATE_LABEL = "»»» REIMAGINE IT «««";
const GENERATE_ANOTHER_LABEL = "»»» REIMAGINE ANOTHER «««";

function useReimaginableSongs(): Song[] {
	const { data } = useQuery({
		queryKey: ["songs", "all"],
		queryFn: () => api.get<Song[]>("/api/songs"),
		staleTime: 30_000,
	});
	return useMemo(
		() =>
			(data ?? []).filter(
				(s) =>
					(s.status === "ready" || s.status === "played") &&
					s.audioUrl &&
					s.lyrics,
			),
		[data],
	);
}

function ReimaginePage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const reimagine = useReimagineSong();
	const reimagineFromUrl = useReimagineFromUrl();
	const sourceSongs = useReimaginableSongs();
	const [sourceMode, setSourceMode] = useState<"library" | "url">("library");
	const [sourceUrl, setSourceUrl] = useState("");
	const [sourceTrackTitle, setSourceTrackTitle] = useState("");
	const [sourceArtistName, setSourceArtistName] = useState("");
	const [urlLyrics, setUrlLyrics] = useState("");

	// Restore an in-flight generation from the URL key
	const playlistByKey = usePlaylistByKey(pl ?? null);
	const playlistIdFromUrl = playlistByKey?.id ?? null;
	const [localPlaylistId, setLocalPlaylistId] = useState<string | null>(null);
	const playlistId = playlistIdFromUrl ?? localPlaylistId;

	const [sourceId, setSourceId] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [style, setStyle] = useState("");
	const [fidelity, setFidelity] = useState<number>(0.5);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const filteredSongs = useMemo(() => {
		if (!filter.trim()) return sourceSongs;
		const q = filter.toLowerCase();
		return sourceSongs.filter(
			(s) =>
				(s.title ?? "").toLowerCase().includes(q) ||
				(s.artistName ?? "").toLowerCase().includes(q) ||
				(s.genre ?? "").toLowerCase().includes(q),
		);
	}, [sourceSongs, filter]);
	const sourceSong = sourceSongs.find((s) => s.id === sourceId) ?? null;

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

	// Auto-play once the reimagined song is ready
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

	const hasCompleteLrclibIdentity =
		(!sourceTrackTitle.trim() && !sourceArtistName.trim()) ||
		Boolean(sourceTrackTitle.trim() && sourceArtistName.trim());
	const canSubmit =
		sourceMode === "library"
			? !!sourceId
			: sourceUrl.trim().length > 0 && hasCompleteLrclibIdentity;

	const handleGenerate = useCallback(async () => {
		if (!canSubmit || !style.trim() || generating) return;
		setSubmitting(true);
		setSubmitError(null);
		hasAutoPlayed.current = false;

		try {
			const playlistKey = generatePlaylistKey();
			const result =
				sourceMode === "library" && sourceId
					? await reimagine({
							sourceSongId: sourceId,
							style: style.trim(),
							coverNoiseStrength: fidelity,
							playlistKey,
						})
					: await reimagineFromUrl({
							url: sourceUrl.trim(),
							style: style.trim(),
							lyrics: urlLyrics.trim(),
							sourceTrackTitle: sourceTrackTitle.trim() || undefined,
							sourceArtistName: sourceArtistName.trim() || undefined,
							coverNoiseStrength: fidelity,
							playlistKey,
						});
			setLocalPlaylistId(result.playlist.id);
			navigate({ to: "/autoplayer/reimagine", search: { pl: playlistKey } });
		} catch (error) {
			setSubmitError(
				error instanceof Error ? error.message : "Submission failed",
			);
		} finally {
			setSubmitting(false);
		}
	}, [
		canSubmit,
		sourceMode,
		sourceId,
		sourceUrl,
		sourceTrackTitle,
		sourceArtistName,
		urlLyrics,
		style,
		fidelity,
		generating,
		reimagine,
		reimagineFromUrl,
		navigate,
	]);

	const handleGenerateAnother = useCallback(() => {
		setLocalPlaylistId(null);
		setSubmitError(null);
		hasAutoPlayed.current = false;
		navigate({ to: "/autoplayer/reimagine", search: {} });
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
			<header className="border-b-4 border-fuchsia-500/30 bg-black shrink-0">
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
							<Sparkles className="h-5 w-5 text-fuchsia-400" />
							<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
								REIMAGINE
							</h1>
						</div>
					</div>
					<button
						type="button"
						className="font-mono text-sm font-bold uppercase text-white/60 hover:text-fuchsia-400"
						onClick={() => navigate({ to: "/autoplayer/oneshot", search: {} })}
					>
						[ONESHOT]
					</button>
				</div>
				<p className="px-4 pb-3 text-[10px] font-bold uppercase tracking-widest text-fuchsia-400/50">
					SAME SONG, NEW STYLE — THE ORIGINAL AUDIO GUIDES THE RENDER
				</p>
			</header>

			{/* ═══ MAIN ═══ */}
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-3xl mx-auto p-4 sm:p-6">
					{/* ─── INPUT ─── */}
					<div className="border-4 border-fuchsia-500/20 bg-black">
						<div className="border-b-4 border-fuchsia-500/20 px-4 py-3 flex items-center gap-2">
							<Sparkles className="h-4 w-4 text-fuchsia-400" />
							<span className="text-sm font-black uppercase tracking-widest">
								SOURCE &amp; TARGET STYLE
							</span>
						</div>

						<div className="p-6 space-y-5">
							<div>
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									SOURCE
								</p>
								<div className="flex gap-0">
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
											sourceMode === "library"
												? "bg-fuchsia-400 text-black"
												: "bg-transparent text-white hover:bg-white/10"
										}`}
										onClick={() => setSourceMode("library")}
										disabled={generating}
									>
										MY LIBRARY
									</button>
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
											sourceMode === "url"
												? "bg-fuchsia-400 text-black"
												: "bg-transparent text-white hover:bg-white/10"
										}`}
										onClick={() => setSourceMode("url")}
										disabled={generating}
									>
										YOUTUBE / URL
									</button>
								</div>
							</div>

							{sourceMode === "url" && (
								<>
									<div>
										<p className="text-xs font-bold uppercase text-white/50 mb-1">
											SOURCE URL — AUDIO IS DOWNLOADED AS THE REFERENCE
										</p>
										<Input
											className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0"
											placeholder="https://www.youtube.com/watch?v=..."
											value={sourceUrl}
											onChange={(e) => setSourceUrl(e.target.value)}
											disabled={generating}
										/>
										<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
											MAX 10 MINUTES. DOWNLOAD RUNS ON SUBMIT AND CAN TAKE A
											MOMENT.
										</p>
									</div>
									<div className="grid gap-3 sm:grid-cols-2">
										<div>
											<p className="text-xs font-bold uppercase text-white/50 mb-1">
												ORIGINAL TRACK TITLE
											</p>
											<Input
												className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0"
												placeholder="DEAR MR. PRESIDENT"
												value={sourceTrackTitle}
												onChange={(e) => setSourceTrackTitle(e.target.value)}
												disabled={generating}
											/>
										</div>
										<div>
											<p className="text-xs font-bold uppercase text-white/50 mb-1">
												ORIGINAL ARTIST
											</p>
											<Input
												className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0"
												placeholder="P!NK"
												value={sourceArtistName}
												onChange={(e) => setSourceArtistName(e.target.value)}
												disabled={generating}
											/>
										</div>
									</div>
									<p className="-mt-2 text-[10px] font-bold uppercase text-white/30">
										PROVIDE BOTH TO LOAD PLAIN LYRICS FROM LRCLIB. THE
										DOWNLOADED AUDIO DURATION MUST MATCH WITHIN 2 SECONDS.
									</p>
									<div>
										<p className="text-xs font-bold uppercase text-white/50 mb-1">
											LYRICS — OPTIONAL MANUAL OVERRIDE
										</p>
										<Textarea
											className="min-h-[120px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-fuchsia-500/50 resize-y"
											placeholder={
												"[verse]\nPasted lyrics are used instead of LRCLIB.\nLeave empty to load an exact LRCLIB match."
											}
											value={urlLyrics}
											onChange={(e) => setUrlLyrics(e.target.value)}
											disabled={generating}
										/>
									</div>
								</>
							)}

							{sourceMode === "library" && (
								<div>
									<p className="text-xs font-bold uppercase text-white/50 mb-1">
										SOURCE SONG — {sourceSongs.length} AVAILABLE
									</p>
									<Input
										className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0"
										placeholder={`FILTER ${sourceSongs.length} SONGS...`}
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										disabled={generating}
									/>
									<div className="mt-1 max-h-44 overflow-y-auto border-4 border-white/20 bg-gray-900">
										{filteredSongs.slice(0, 50).map((s) => (
											<button
												key={s.id}
												type="button"
												className={`w-full text-left px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
													sourceId === s.id
														? "bg-fuchsia-400 text-black font-black"
														: "text-white/70 hover:bg-white/10 hover:text-white"
												}`}
												onClick={() => setSourceId(s.id)}
												disabled={generating}
											>
												<span className="block font-black truncate">
													{s.title || "Untitled"}
												</span>
												<span className="block text-[10px] opacity-70 truncate">
													{s.artistName || "Unknown"} · {s.genre || "?"} ·{" "}
													{s.audioDuration
														? formatTime(s.audioDuration)
														: "?:??"}
												</span>
											</button>
										))}
										{filteredSongs.length === 0 && (
											<p className="px-3 py-2 text-[10px] font-bold uppercase text-white/30">
												NO SONGS WITH AUDIO + LYRICS FOUND
											</p>
										)}
									</div>
									{sourceSong && (
										<p className="mt-1 text-[10px] font-black uppercase text-fuchsia-400">
											✓ {sourceSong.title} — LYRICS &amp; AUDIO GO IN AS THE
											REFERENCE
										</p>
									)}
								</div>
							)}

							<div>
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									TARGET STYLE — WHAT IT SHOULD BECOME
								</p>
								<Textarea
									className="min-h-[80px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-fuchsia-500/50 resize-y"
									placeholder="neue deutsche welle, dry drum machines, analog synths, staccato guitars, deadpan vocals"
									value={style}
									onChange={(e) => setStyle(e.target.value)}
									disabled={generating}
								/>
							</div>

							<div>
								<p className="text-xs font-bold uppercase text-white/50 mb-1">
									FIDELITY TO ORIGINAL
								</p>
								<div className="flex gap-0">
									{FIDELITY_OPTIONS.map((opt, i) => (
										<button
											key={opt.value}
											type="button"
											className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
												i > 0 ? "border-l-0" : ""
											} ${
												fidelity === opt.value
													? "bg-fuchsia-400 text-black"
													: "bg-transparent text-white hover:bg-white/10"
											}`}
											onClick={() => setFidelity(opt.value)}
											disabled={generating}
										>
											{opt.label}
										</button>
									))}
								</div>
								<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
									{FIDELITY_OPTIONS.find((o) => o.value === fidelity)?.hint}
								</p>
							</div>

							{submitError && (
								<p className="text-xs font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
									{submitError}
								</p>
							)}

							<Button
								className="w-full h-14 rounded-none border-4 border-fuchsia-500/30 bg-fuchsia-400 font-mono text-lg font-black uppercase text-black hover:bg-white hover:text-black hover:border-white disabled:opacity-30 disabled:hover:bg-fuchsia-400 disabled:hover:border-fuchsia-500/30"
								onClick={handleGenerate}
								disabled={!canSubmit || !style.trim() || generating}
							>
								{generating ? (
									<span className="flex items-center gap-2">
										<Sparkles className="h-5 w-5 animate-pulse" />
										REIMAGINING...
									</span>
								) : (
									GENERATE_LABEL
								)}
							</Button>
						</div>
					</div>

					{/* ─── OUTPUT ─── */}
					{showOutput && (
						<div className="border-4 border-t-0 border-fuchsia-500/20 bg-black">
							{(phase === "creating" || phase === "generating") && (
								<div className="p-6 flex items-center gap-3">
									<Sparkles className="h-5 w-5 text-fuchsia-400 animate-pulse" />
									<span className="text-sm font-black uppercase tracking-widest text-fuchsia-400/80">
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
											REIMAGINE FAILED
										</span>
									</div>
									{song?.errorMessage && (
										<p className="text-xs font-bold uppercase text-white/40 mb-4">
											{song.errorMessage}
										</p>
									)}
									<Button
										className="w-full h-12 rounded-none border-4 border-fuchsia-500/30 bg-fuchsia-400 font-mono text-base font-black uppercase text-black hover:bg-white"
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
												artistName={song.artistName || "REIMAGINED"}
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
													{song.caption || "REIMAGINED"}
												</p>
											</div>

											<div className="p-4 space-y-3">
												<div className="flex items-center gap-3">
													<button
														type="button"
														className="shrink-0 h-10 w-10 border-2 border-fuchsia-400 flex items-center justify-center text-fuchsia-400 hover:bg-fuchsia-400 hover:text-black transition-colors"
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
																className="h-full bg-fuchsia-400 transition-all"
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
															download={`${song.title || "reimagined"}.mp3`}
															className="flex items-center gap-1 text-xs font-bold uppercase text-white/40 hover:text-fuchsia-400 transition-colors"
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
											className="w-full h-12 rounded-none border-4 border-fuchsia-500/30 bg-transparent font-mono text-base font-black uppercase text-fuchsia-400 hover:bg-fuchsia-400 hover:text-black hover:border-fuchsia-400"
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
			<footer className="bg-black px-4 py-2 border-t-4 border-fuchsia-500/20 shrink-0">
				<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/40">
					<span className="flex items-center gap-2">
						<Sparkles className="h-3 w-3 text-fuchsia-400/60" />
						REIMAGINE {"//"} ACE COVER TASK — SOURCE AUDIO AS REFERENCE
					</span>
					<span className="text-fuchsia-400/40">
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
