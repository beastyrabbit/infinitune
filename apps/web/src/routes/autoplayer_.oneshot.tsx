import {
	GPT52_TEXT_MODEL,
	GPT52_TEXT_PROVIDER,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
	AlertTriangle,
	ArrowLeft,
	BookOpen,
	ChevronDown,
	ChevronUp,
	Download,
	Pause,
	Play,
	RefreshCw,
	Sparkles,
	Volume2,
	VolumeX,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CoverArt } from "@/components/autoplayer/CoverArt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	useCreatePlaylist,
	usePlaylistByKey,
	useSettings,
} from "@/integrations/api/hooks";
import { API_URL } from "@/lib/endpoints";
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
	component: OneshotPage,
	validateSearch: validatePlaylistKeySearch,
});

// ─── Constants ──────────────────────────────────────────────────────

interface ModelOption {
	name: string;
	displayName?: string;
	is_default?: boolean;
	inputModalities?: string[];
	type?: string;
	vision?: boolean;
}

// Stored as constants to avoid TS/git merge-conflict-marker false positives
const GENERATE_LABEL = "\u00BB\u00BB\u00BB GENERATE SONG \u00AB\u00AB\u00AB";
const GENERATE_ANOTHER_LABEL =
	"\u00BB\u00BB\u00BB GENERATE ANOTHER \u00AB\u00AB\u00AB";

const LANGUAGES = [
	{ value: "auto", label: "AUTO" },
	{ value: "english", label: "ENGLISH" },
	{ value: "german", label: "GERMAN" },
] as const;

// ─── Main Component ─────────────────────────────────────────────────

function OneshotPage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const createPlaylist = useCreatePlaylist();
	const settings = useSettings();

	// Look up playlist by key from URL
	const playlistByKey = usePlaylistByKey(pl ?? null);
	const playlistIdFromUrl = playlistByKey?.id ?? null;

	// ── Local state ──
	const [prompt, setPrompt] = useState("");
	const [provider, setProvider] = useState<LlmProvider>(GPT52_TEXT_PROVIDER);
	const [model, setModel] = useState(GPT52_TEXT_MODEL);
	const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
	const [codexModels, setCodexModels] = useState<ModelOption[]>([]);
	const [enhancing, setEnhancing] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [lyricsOpen, setLyricsOpen] = useState(false);
	const [localPlaylistId, setLocalPlaylistId] = useState<string | null>(null);

	// Use URL-based playlist ID if available, otherwise local state
	const playlistId = playlistIdFromUrl ?? localPlaylistId;

	// Advanced settings — local state, passed to playlist create
	const [language, setLanguage] = useState("auto");
	const [bpm, setBpm] = useState("");
	const [key, setKey] = useState("");
	const [timeSig, setTimeSig] = useState("");
	const [duration, setDuration_] = useState("");
	const [steps, setSteps] = useState("8");
	const [lmTemp, setLmTemp] = useState("0.85");
	const [lmCfg, setLmCfg] = useState("2.5");
	const [inferMeth, setInferMeth] = useState("ode");

	const modelSetByUserOrSettings = useRef(false);

	// ── Oneshot subscription ──
	const { song, phase } = useOneshot(playlistId);

	// ── Audio player ──
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

	// Auto-play when song becomes ready
	const hasAutoPlayed = useRef(false);
	useEffect(() => {
		if (phase === "ready" && song?.audioUrl && !hasAutoPlayed.current) {
			hasAutoPlayed.current = true;
			setCurrentSong(song.id);
			loadAndPlay(song.audioUrl);
		}
	}, [phase, song, loadAndPlay]);

	// ── Settings defaults ──
	const settingsApplied = useRef(false);
	useEffect(() => {
		if (!settings || settingsApplied.current) return;
		settingsApplied.current = true;
		if (settings.textProvider)
			setProvider(settings.textProvider as LlmProvider);
		if (settings.textModel) {
			setModel(settings.textModel);
			modelSetByUserOrSettings.current = true;
		}
	}, [settings]);

	// ── Ollama models ──
	useEffect(() => {
		fetch(`${API_URL}/api/autoplayer/ollama-models`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => {
				const allModels = d.models || [];
				setOllamaModels(allModels);
				if (!modelSetByUserOrSettings.current) {
					const textOnly = allModels.filter(
						(m: ModelOption) => m.type === "text" || (!m.type && !m.vision),
					);
					if (textOnly.length > 0) {
						const preferred = textOnly.find(
							(m: ModelOption) => m.name === "gpt-oss:20b",
						);
						setModel(preferred ? preferred.name : textOnly[0].name);
					}
				}
			})
			.catch(() => {});

		fetch(`${API_URL}/api/autoplayer/codex-models`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => setCodexModels(d.models || []))
			.catch(() => setCodexModels([]));
	}, []);

	const textModels = useMemo(
		() =>
			ollamaModels.filter((m) => m.type === "text" || (!m.type && !m.vision)),
		[ollamaModels],
	);
	const codexTextModels = useMemo(
		() =>
			codexModels.filter(
				(m) => m.type === "text" || m.inputModalities?.includes("text"),
			),
		[codexModels],
	);

	useEffect(() => {
		if (provider === "ollama" && textModels.length > 0) {
			if (!textModels.some((m) => m.name === model)) {
				const preferred = textModels.find((m) => m.name === "gpt-oss:20b");
				setModel(preferred ? preferred.name : textModels[0].name);
			}
			return;
		}

		if (provider === "openrouter" && !model.trim()) {
			setModel(GPT52_TEXT_MODEL);
			return;
		}

		if (provider === "openai-codex" && codexTextModels.length > 0) {
			if (!codexTextModels.some((m) => m.name === model)) {
				const preferred =
					codexTextModels.find((m) => m.is_default) || codexTextModels[0];
				setModel(preferred.name);
			}
		}
	}, [provider, model, textModels, codexTextModels]);

	// ── Handlers ──
	const handleEnhancePrompt = useCallback(async () => {
		if (!prompt.trim() || !model.trim() || enhancing) return;
		setEnhancing(true);
		try {
			const res = await fetch("/api/autoplayer/enhance-prompt", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: prompt.trim(), provider, model }),
			});
			if (res.ok) {
				const data = await res.json();
				if (data.result) setPrompt(data.result);
			}
		} catch {
			// User still has original prompt
		} finally {
			setEnhancing(false);
		}
	}, [prompt, provider, model, enhancing]);

	const handleGenerate = useCallback(async () => {
		if (!prompt.trim() || !model.trim() || generating) return;
		setGenerating(true);
		hasAutoPlayed.current = false;

		try {
			// Enhance playlist params
			let playlistParams: Record<string, unknown> = {};
			try {
				const res = await fetch("/api/autoplayer/enhance-session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ prompt: prompt.trim(), provider, model }),
				});
				if (res.ok) playlistParams = await res.json();
			} catch {
				// Continue without enhanced params
			}

			// Merge user overrides with AI params
			const name = `[ONESHOT] ${prompt.trim().slice(0, 40)}`;
			const playlistKey = generatePlaylistKey();
			const result = await createPlaylist({
				name,
				prompt: prompt.trim(),
				llmProvider: provider,
				llmModel: model,
				mode: "oneshot",
				playlistKey: playlistKey,
				lyricsLanguage:
					language !== "auto"
						? language
						: (playlistParams.lyricsLanguage as string | undefined),
				targetBpm: bpm
					? Number.parseInt(bpm, 10)
					: (playlistParams.targetBpm as number | undefined),
				targetKey: key || (playlistParams.targetKey as string | undefined),
				timeSignature:
					timeSig || (playlistParams.timeSignature as string | undefined),
				audioDuration: duration
					? Number.parseInt(duration, 10)
					: (playlistParams.audioDuration as number | undefined),
				inferenceSteps: steps
					? Number.parseInt(steps, 10)
					: (playlistParams.inferenceSteps as number | undefined),
				lmTemperature: lmTemp ? Number.parseFloat(lmTemp) : undefined,
				lmCfgScale: lmCfg ? Number.parseFloat(lmCfg) : undefined,
				inferMethod: inferMeth,
			});
			setLocalPlaylistId(result.id);
			navigate({ to: "/autoplayer/oneshot", search: { pl: playlistKey } });
		} catch {
			// Fallback
			setGenerating(false);
		}
	}, [
		prompt,
		provider,
		model,
		generating,
		language,
		bpm,
		key,
		timeSig,
		duration,
		steps,
		lmTemp,
		lmCfg,
		inferMeth,
		createPlaylist,
		navigate,
	]);

	const handleGenerateAnother = useCallback(() => {
		setLocalPlaylistId(null);
		setGenerating(false);
		hasAutoPlayed.current = false;
		setLyricsOpen(false);
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
	const showOutput = phase !== "idle" || generating;
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
								ONESHOT
							</h1>
							<Badge className="rounded-none border-2 border-yellow-500/40 bg-transparent font-mono text-xs text-yellow-500/60">
								V1.0
							</Badge>
						</div>
					</div>
					<div className="flex items-center gap-4">
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
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
							onClick={() =>
								navigate({ to: "/autoplayer/settings", search: (prev) => prev })
							}
						>
							[SETTINGS]
						</button>
					</div>
				</div>
			</header>

			{/* ═══ MAIN CONTENT ═══ */}
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-0">
					{/* ─── INPUT SECTION ─── */}
					<div className="border-4 border-yellow-500/20 bg-black">
						{/* Card header */}
						<div className="border-b-4 border-yellow-500/20 px-4 py-3 flex items-center gap-2">
							<Zap className="h-4 w-4 text-yellow-500" />
							<span className="text-sm font-black uppercase tracking-widest">
								DESCRIBE YOUR SONG
							</span>
						</div>

						<div className="p-6 space-y-5">
							{/* Prompt */}
							<div>
								<Textarea
									className="min-h-[100px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-yellow-500/50 resize-none"
									placeholder="A MELANCHOLIC SYNTH BALLAD ABOUT FADING CITY LIGHTS WITH ETHEREAL VOCALS AND A SLOW BUILD TO A EUPHORIC DROP..."
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									disabled={
										generating && phase !== "ready" && phase !== "error"
									}
								/>
								<button
									type="button"
									className={`mt-2 flex items-center gap-1 font-mono text-xs font-bold uppercase transition-colors ${
										enhancing
											? "text-yellow-500 animate-pulse"
											: "text-white/40 hover:text-yellow-500"
									}`}
									onClick={handleEnhancePrompt}
									disabled={
										!prompt.trim() ||
										!model.trim() ||
										enhancing ||
										(generating && phase !== "ready" && phase !== "error")
									}
								>
									<Sparkles className="h-3 w-3" />
									{enhancing ? "[ENHANCING...]" : "[ENHANCE PROMPT]"}
								</button>
							</div>

							{/* Provider + Model */}
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div>
									{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
									<label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
										PROVIDER
									</label>
									<div className="flex gap-0">
										<button
											type="button"
											className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
												provider === "ollama"
													? "bg-yellow-500 text-black border-yellow-500"
													: "bg-transparent text-white hover:bg-white/10"
											}`}
											onClick={() => setProvider("ollama")}
										>
											OLLAMA
										</button>
										<button
											type="button"
											className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
												provider === "openrouter"
													? "bg-yellow-500 text-black border-yellow-500"
													: "bg-transparent text-white hover:bg-white/10"
											}`}
											onClick={() => setProvider("openrouter")}
										>
											OPENROUTER
										</button>
										<button
											type="button"
											className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
												provider === "openai-codex"
													? "bg-yellow-500 text-black border-yellow-500"
													: "bg-transparent text-white hover:bg-white/10"
											}`}
											onClick={() => setProvider("openai-codex")}
										>
											OPENAI CODEX
										</button>
									</div>
								</div>

								<div>
									{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
									<label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
										TEXT MODEL
									</label>
									{provider === "ollama" && textModels.length > 0 ? (
										<Select value={model} onValueChange={setModel}>
											<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
												<SelectValue placeholder="SELECT MODEL" />
											</SelectTrigger>
											<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
												{textModels.map((m) => (
													<SelectItem
														key={m.name}
														value={m.name}
														className="font-mono text-sm font-bold uppercase text-white"
													>
														{m.name.toUpperCase()}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : provider === "openai-codex" &&
										codexTextModels.length > 0 ? (
										<Select value={model} onValueChange={setModel}>
											<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
												<SelectValue placeholder="SELECT CODEX MODEL" />
											</SelectTrigger>
											<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
												{codexTextModels.map((m) => (
													<SelectItem
														key={m.name}
														value={m.name}
														className="font-mono text-sm font-bold uppercase text-white"
													>
														{(m.displayName || m.name).toUpperCase()}
														{m.is_default ? " (DEFAULT)" : ""}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : (
										<Input
											className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
											placeholder={
												provider === "openrouter"
													? "OPENAI/GPT-5.2"
													: provider === "openai-codex"
														? "GPT-5.3-CODEX"
														: "LLAMA3.1:8B"
											}
											value={model}
											onChange={(e) => setModel(e.target.value)}
										/>
									)}
								</div>
							</div>

							{/* Advanced Settings Toggle */}
							<button
								type="button"
								className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
								onClick={() => setAdvancedOpen(!advancedOpen)}
							>
								{advancedOpen ? (
									<ChevronUp className="h-3 w-3" />
								) : (
									<ChevronDown className="h-3 w-3" />
								)}
								ADVANCED SETTINGS
							</button>

							{/* Advanced Settings Panel */}
							{advancedOpen && (
								<div className="border-4 border-white/10 bg-gray-900/50 p-4 space-y-4">
									{/* Language */}
									<div>
										{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
										<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
											LYRICS LANGUAGE
										</label>
										<select
											value={language}
											onChange={(e) => setLanguage(e.target.value)}
											className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white focus:border-yellow-500 focus:outline-none"
										>
											{LANGUAGES.map((lang) => (
												<option key={lang.value} value={lang.value}>
													{lang.label}
												</option>
											))}
										</select>
									</div>

									{/* BPM + Key */}
									<div className="grid grid-cols-2 gap-3">
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												BPM
											</label>
											<input
												type="text"
												inputMode="numeric"
												value={bpm}
												onChange={(e) => {
													if (
														e.target.value === "" ||
														/^\d+$/.test(e.target.value)
													)
														setBpm(e.target.value);
												}}
												placeholder="AUTO"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
										</div>
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												KEY
											</label>
											<input
												type="text"
												value={key}
												onChange={(e) => setKey(e.target.value)}
												placeholder="AUTO"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
										</div>
									</div>

									{/* Time Sig + Duration */}
									<div className="grid grid-cols-2 gap-3">
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												TIME SIG
											</label>
											<input
												type="text"
												value={timeSig}
												onChange={(e) => setTimeSig(e.target.value)}
												placeholder="4/4"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
										</div>
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												DURATION (S)
											</label>
											<input
												type="text"
												inputMode="numeric"
												value={duration}
												onChange={(e) => {
													if (
														e.target.value === "" ||
														/^\d+$/.test(e.target.value)
													)
														setDuration_(e.target.value);
												}}
												placeholder="AUTO"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
										</div>
									</div>

									{/* Inference Steps */}
									<div>
										{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
										<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
											INFERENCE STEPS
										</label>
										<input
											type="text"
											inputMode="numeric"
											value={steps}
											onChange={(e) => {
												if (
													e.target.value === "" ||
													/^\d+$/.test(e.target.value)
												)
													setSteps(e.target.value);
											}}
											placeholder="12"
											className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
										/>
										<p className="mt-1 text-[10px] text-white/20 uppercase">
											4-16 — HIGHER = BETTER QUALITY, SLOWER
										</p>
									</div>

									{/* LM Temp + CFG */}
									<div className="grid grid-cols-2 gap-3">
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												LM TEMP
											</label>
											<input
												type="text"
												inputMode="decimal"
												value={lmTemp}
												onChange={(e) => {
													if (
														e.target.value === "" ||
														/^\d*\.?\d*$/.test(e.target.value)
													)
														setLmTemp(e.target.value);
												}}
												placeholder="0.85"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
											<p className="mt-1 text-[10px] text-white/20 uppercase">
												0.1-1.5
											</p>
										</div>
										<div>
											{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
											<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
												LM CFG
											</label>
											<input
												type="text"
												inputMode="decimal"
												value={lmCfg}
												onChange={(e) => {
													if (
														e.target.value === "" ||
														/^\d*\.?\d*$/.test(e.target.value)
													)
														setLmCfg(e.target.value);
												}}
												placeholder="2.5"
												className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-yellow-500 focus:outline-none"
											/>
											<p className="mt-1 text-[10px] text-white/20 uppercase">
												1.0-5.0
											</p>
										</div>
									</div>

									{/* Diffusion Method */}
									<div>
										{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
										<label className="text-xs font-bold uppercase text-white/50 mb-1 block">
											DIFFUSION METHOD
										</label>
										<div className="flex gap-0">
											<button
												type="button"
												className={`flex-1 h-9 border-2 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
													inferMeth === "ode"
														? "bg-yellow-500 text-black border-yellow-500"
														: "bg-transparent text-white hover:bg-white/10"
												}`}
												onClick={() => setInferMeth("ode")}
											>
												ODE (FASTER)
											</button>
											<button
												type="button"
												className={`flex-1 h-9 border-2 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
													inferMeth === "sde"
														? "bg-yellow-500 text-black border-yellow-500"
														: "bg-transparent text-white hover:bg-white/10"
												}`}
												onClick={() => setInferMeth("sde")}
											>
												SDE (STOCHASTIC)
											</button>
										</div>
									</div>
								</div>
							)}

							{/* Generate Button */}
							<Button
								className="w-full h-14 rounded-none border-4 border-yellow-500/30 bg-yellow-500 font-mono text-lg font-black uppercase text-black hover:bg-white hover:text-black hover:border-white disabled:opacity-30 disabled:hover:bg-yellow-500 disabled:hover:border-yellow-500/30"
								onClick={handleGenerate}
								disabled={
									!prompt.trim() ||
									!model.trim() ||
									(generating && phase !== "ready" && phase !== "error")
								}
							>
								{generating && phase !== "ready" && phase !== "error" ? (
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

					{/* ─── OUTPUT SECTION ─── */}
					{showOutput && (
						<div className="border-4 border-t-0 border-yellow-500/20 bg-black">
							{/* Generating state */}
							{(phase === "creating" || phase === "generating") && (
								<GeneratingDisplay song={song} />
							)}

							{/* Error state */}
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

							{/* Ready state */}
							{phase === "ready" && song && (
								<div>
									{/* Song result */}
									<div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] border-b-4 border-white/10">
										{/* Cover art */}
										<div className="border-b-4 sm:border-b-0 sm:border-r-4 border-white/10">
											<CoverArt
												title={song.title || "UNTITLED"}
												artistName={song.artistName || "UNKNOWN"}
												coverUrl={song.coverUrl}
												size="md"
												spinning={!!isCurrentSong && isPlaying}
											/>
										</div>

										{/* Song info + player */}
										<div className="flex flex-col">
											{/* Metadata */}
											<div className="p-4 border-b-2 border-white/10 flex-1">
												<h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-tight">
													{song.title || "UNTITLED"}
												</h2>
												<p className="text-sm font-bold uppercase text-white/50 mt-1">
													{song.artistName || "UNKNOWN"}
												</p>
												<div className="flex flex-wrap gap-2 mt-3">
													{song.genre && (
														<span className="border-2 border-yellow-500/30 px-2 py-0.5 text-[10px] font-black uppercase text-yellow-500/80">
															{song.genre}
														</span>
													)}
													{song.subGenre && song.subGenre !== song.genre && (
														<span className="border-2 border-white/15 px-2 py-0.5 text-[10px] font-black uppercase text-white/40">
															{song.subGenre}
														</span>
													)}
													{song.mood && (
														<span className="border-2 border-white/15 px-2 py-0.5 text-[10px] font-black uppercase text-white/40">
															{song.mood}
														</span>
													)}
													{song.bpm && (
														<span className="border-2 border-white/15 px-2 py-0.5 text-[10px] font-black uppercase text-white/40">
															{song.bpm} BPM
														</span>
													)}
												</div>
											</div>

											{/* Player controls */}
											<div className="p-4 space-y-3">
												{/* Play + progress */}
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

												{/* Volume + actions */}
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

													<div className="flex items-center gap-2">
														{/* Lyrics toggle */}
														{song.lyrics && (
															<button
																type="button"
																className={`flex items-center gap-1 text-xs font-bold uppercase transition-colors ${
																	lyricsOpen
																		? "text-yellow-500"
																		: "text-white/40 hover:text-white"
																}`}
																onClick={() => setLyricsOpen(!lyricsOpen)}
															>
																<BookOpen className="h-3.5 w-3.5" />
																LYRICS
															</button>
														)}
														{/* Download */}
														{song.audioUrl && (
															<a
																href={song.audioUrl}
																download={`${song.title || "oneshot"}.mp3`}
																className="flex items-center gap-1 text-xs font-bold uppercase text-white/40 hover:text-yellow-500 transition-colors"
															>
																<Download className="h-3.5 w-3.5" />
																DL
															</a>
														)}
													</div>
												</div>
											</div>
										</div>
									</div>

									{/* Lyrics panel */}
									{lyricsOpen && song.lyrics && (
										<div className="border-b-4 border-white/10 p-6">
											<div className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">
												LYRICS
											</div>
											<pre className="font-mono text-sm text-white/70 whitespace-pre-wrap leading-relaxed">
												{song.lyrics}
											</pre>
										</div>
									)}

									{/* Generate Another */}
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
						ONESHOT V1.0 {"//"} SINGLE TRACK GENERATOR
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

// ─── Generating Animation Component ─────────────────────────────────

function GeneratingDisplay({
	song,
}: {
	song: { status: string; title?: string | null } | null;
}) {
	const [dots, setDots] = useState("");

	useEffect(() => {
		const interval = setInterval(() => {
			setDots((d) => (d.length >= 3 ? "" : `${d}.`));
		}, 400);
		return () => clearInterval(interval);
	}, []);

	const statusText = song
		? STATUS_PROGRESS_TEXT[song.status] || "PROCESSING..."
		: "INITIALIZING...";

	return (
		<div className="p-8 flex flex-col items-center justify-center min-h-[200px] relative overflow-hidden">
			{/* Scanner line animation */}
			<div
				className="absolute inset-0 pointer-events-none"
				style={{
					background:
						"repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(234,179,8,0.03) 3px, rgba(234,179,8,0.03) 4px)",
				}}
			/>
			<div className="absolute left-0 right-0 h-px bg-yellow-500/40 animate-[scanline_2s_ease-in-out_infinite]" />

			{/* Status text */}
			<div className="relative z-10 text-center">
				<Zap className="h-8 w-8 text-yellow-500 mx-auto mb-4 animate-pulse" />
				<p className="text-lg font-black uppercase tracking-widest text-yellow-500">
					{statusText}
					{dots}
				</p>
				{song?.title && (
					<p className="mt-3 text-sm font-bold uppercase text-white/40">
						{song.title}
					</p>
				)}
				{/* Progress indicator */}
				<div className="mt-4 flex items-center gap-1 justify-center">
					{[
						"pending",
						"generating_metadata",
						"metadata_ready",
						"submitting_to_ace",
						"generating_audio",
						"saving",
					].map((step, i) => {
						const currentIndex = song
							? [
									"pending",
									"generating_metadata",
									"metadata_ready",
									"submitting_to_ace",
									"generating_audio",
									"saving",
								].indexOf(song.status)
							: -1;
						const isActive = i === currentIndex;
						const isDone = i < currentIndex;
						return (
							<div
								key={step}
								className={`h-1.5 w-6 transition-colors ${
									isActive
										? "bg-yellow-500 animate-pulse"
										: isDone
											? "bg-yellow-500/60"
											: "bg-white/10"
								}`}
							/>
						);
					})}
				</div>
			</div>

			{/* Inline keyframes */}
			<style>{`
				@keyframes scanline {
					0% { top: 0%; opacity: 0; }
					10% { opacity: 1; }
					90% { opacity: 1; }
					100% { top: 100%; opacity: 0; }
				}
			`}</style>
		</div>
	);
}
