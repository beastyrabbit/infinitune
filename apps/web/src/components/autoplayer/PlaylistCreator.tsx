import {
	ACE_DCW_DEFAULTS,
	normalizeAceDcwScaler,
	resolveAceModelSetting,
} from "@infinitune/shared/ace-settings";
import {
	DEFAULT_ANTHROPIC_TEXT_MODEL,
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	DEFAULT_TEXT_PROVIDER,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { Headphones, Library, List, Monitor, Radio, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import GearIcon from "@/components/ui/gear-icon";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import SparklesIcon from "@/components/ui/sparkles-icon";
import { Textarea } from "@/components/ui/textarea";
import VinylIcon from "@/components/ui/vinyl-icon";
import {
	api,
	getRequestErrorMessage,
	isTimeoutError,
} from "@/integrations/api/client";
import {
	useAutoplayerCodexModels,
	useSettings,
} from "@/integrations/api/hooks";

type PlaybackMode = "local" | "room";

interface EnhancedSessionParams {
	lyricsLanguage?: string;
	targetBpm?: number;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
	inferenceSteps?: number;
}

interface PlaylistCreatorProps {
	onCreatePlaylist: (data: {
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
		lmTemperature?: number;
		lmCfgScale?: number;
		inferMethod?: string;
		aceModel?: string;
		aceDcwEnabled?: boolean;
		aceDcwMode?: string;
		aceDcwScaler?: number;
		aceDcwHighScaler?: number;
		aceDcwWavelet?: string;
		aceThinking?: boolean;
		aceAutoDuration?: boolean;
		initialDirectorPlan?: boolean;
		roomSlug?: string;
	}) => void;
	onOpenSettings: () => void;
	onOpenLibrary?: () => void;
	onOpenOneshot?: () => void;
	onOpenPlaylists?: () => void;
	onOpenHouse?: () => void;
	onCreatePlaylistInRoom?: (data: {
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
		lmTemperature?: number;
		lmCfgScale?: number;
		inferMethod?: string;
		aceModel?: string;
		aceDcwEnabled?: boolean;
		aceDcwMode?: string;
		aceDcwScaler?: number;
		aceDcwHighScaler?: number;
		aceDcwWavelet?: string;
		aceThinking?: boolean;
		aceAutoDuration?: boolean;
		initialDirectorPlan?: boolean;
		roomSlug?: string;
	}) => void;
}

const DEFAULT_ENHANCE_TIMEOUT_MS = 15000;

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 30);
}

export function PlaylistCreator({
	onCreatePlaylist,
	onOpenSettings,
	onOpenLibrary,
	onOpenOneshot,
	onOpenPlaylists,
	onOpenHouse,
	onCreatePlaylistInRoom,
}: PlaylistCreatorProps) {
	const [prompt, setPrompt] = useState("");
	const [provider, setProvider] = useState<LlmProvider>(DEFAULT_TEXT_PROVIDER);
	const [model, setModel] = useState("");
	const codexModels = useAutoplayerCodexModels() ?? [];
	const [loading, setLoading] = useState(false);
	const [enhancing, setEnhancing] = useState(false);
	const [loadingState, setLoadingState] = useState("");
	const [statusMessage, setStatusMessage] = useState("");
	const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("local");
	const [roomName, setRoomName] = useState("");
	const [roomNameEdited, setRoomNameEdited] = useState(false);

	const settings = useSettings();

	// Auto-generate room name from prompt (unless user has manually edited it)
	useEffect(() => {
		if (!roomNameEdited && prompt.trim()) {
			const words = prompt.trim().split(/\s+/).slice(0, 4).join(" ");
			setRoomName(words);
		}
	}, [prompt, roomNameEdited]);

	// Apply defaults from settings once loaded.
	const settingsApplied = useRef(false);
	useEffect(() => {
		if (!settings || settingsApplied.current) return;
		settingsApplied.current = true;
		const configuredProvider = normalizeLlmProvider(settings.textProvider);
		setProvider(configuredProvider);
		setModel(settings.textModel?.trim() || "");
	}, [settings]);

	const codexTextModels = useMemo(
		() =>
			codexModels.filter(
				(m) => m.type === "text" || m.inputModalities?.includes("text"),
			),
		[codexModels],
	);

	useEffect(() => {
		if (provider === "openai-codex" && codexTextModels.length > 0) {
			if (!codexTextModels.some((m) => m.name === model)) {
				const preferred =
					codexTextModels.find((m) => m.is_default) || codexTextModels[0];
				setModel(preferred.name);
			}
			return;
		}
		if (provider === "openai-codex" && !model.trim()) {
			setModel(DEFAULT_OPENAI_CODEX_TEXT_MODEL);
			return;
		}
		if (provider === "anthropic" && !model.trim()) {
			setModel(DEFAULT_ANTHROPIC_TEXT_MODEL);
		}
	}, [provider, model, codexTextModels]);

	const handleEnhancePrompt = async () => {
		if (!prompt.trim() || !model.trim() || enhancing) return;
		setEnhancing(true);
		setStatusMessage("");
		try {
			const data = await api.post<{
				result?: string;
			}>(
				"/api/autoplayer/enhance-prompt",
				{ prompt: prompt.trim(), provider, model },
				undefined,
				{ timeoutMs: DEFAULT_ENHANCE_TIMEOUT_MS },
			);
			if (data.result) {
				setPrompt(data.result);
			} else {
				setStatusMessage("Enhance request returned no changes.");
			}
		} catch (error) {
			if (!isTimeoutError(error)) {
				setStatusMessage(`Enhance failed: ${getRequestErrorMessage(error)}`);
				return;
			}
			setStatusMessage("Enhance timed out; using the original prompt.");
		} finally {
			setEnhancing(false);
		}
	};

	const preparePlaylistData = async () => {
		setLoading(true);
		setStatusMessage("");
		setLoadingState(
			playbackMode === "room"
				? ">>> CREATING ROOM <<<"
				: ">>> ANALYZING PROMPT <<<",
		);

		const inferenceSteps = settings?.aceInferenceSteps
			? Number.parseInt(settings.aceInferenceSteps, 10)
			: undefined;
		const lmTemperature = settings?.aceLmTemperature
			? Number.parseFloat(settings.aceLmTemperature)
			: undefined;
		const lmCfgScale = settings?.aceLmCfgScale
			? Number.parseFloat(settings.aceLmCfgScale)
			: undefined;
		const inferMethod = settings?.aceInferMethod || undefined;
		const aceModel = resolveAceModelSetting(
			settings?.aceModel,
			settings?.aceModel !== undefined,
		);
		const aceDcwEnabled = settings?.aceDcwEnabled
			? settings.aceDcwEnabled !== "false"
			: ACE_DCW_DEFAULTS.enabled;
		const aceDcwMode = settings?.aceDcwMode || ACE_DCW_DEFAULTS.mode;
		const aceDcwScaler = normalizeAceDcwScaler(
			settings?.aceDcwScaler,
			ACE_DCW_DEFAULTS.scaler,
		);
		const aceDcwHighScaler = normalizeAceDcwScaler(
			settings?.aceDcwHighScaler,
			ACE_DCW_DEFAULTS.highScaler,
		);
		const aceDcwWavelet = settings?.aceDcwWavelet || ACE_DCW_DEFAULTS.wavelet;
		const aceThinking = settings?.aceThinking === "true";
		const aceAutoDuration = settings?.aceAutoDuration !== "false";
		const roomSlug =
			playbackMode === "room"
				? slugify(roomName.trim() || "room") || "room"
				: undefined;
		let enhancedParams: EnhancedSessionParams = {};

		try {
			enhancedParams = await api.post<EnhancedSessionParams>(
				"/api/autoplayer/enhance-session",
				{ prompt: prompt.trim(), provider, model },
				undefined,
				{ timeoutMs: DEFAULT_ENHANCE_TIMEOUT_MS },
			);

			setLoadingState(">>> DIRECTOR PLANNING <<<");

			return {
				name: roomName.trim() || prompt.trim().slice(0, 50),
				prompt: prompt.trim(),
				provider,
				model,
				lyricsLanguage:
					(enhancedParams.lyricsLanguage as string | undefined) || "english",
				targetBpm: enhancedParams.targetBpm as number | undefined,
				targetKey: enhancedParams.targetKey as string | undefined,
				timeSignature: enhancedParams.timeSignature as string | undefined,
				audioDuration: enhancedParams.audioDuration as number | undefined,
				inferenceSteps:
					(enhancedParams.inferenceSteps as number | undefined) ??
					inferenceSteps,
				lmTemperature,
				lmCfgScale,
				inferMethod,
				aceModel,
				aceDcwEnabled,
				aceDcwMode,
				aceDcwScaler,
				aceDcwHighScaler,
				aceDcwWavelet,
				aceThinking,
				aceAutoDuration,
				initialDirectorPlan: true,
				roomSlug,
			};
		} catch (error) {
			const reason = getRequestErrorMessage(error);
			setLoadingState(">>> DIRECTOR PLANNING <<<");
			setStatusMessage(
				`Session analysis failed: ${reason}. Starting with defaults.`,
			);
			return {
				name: roomName.trim() || prompt.trim().slice(0, 50),
				prompt: prompt.trim(),
				provider,
				model,
				lyricsLanguage: "english",
				inferenceSteps,
				lmTemperature,
				lmCfgScale,
				inferMethod,
				aceModel,
				aceDcwEnabled,
				aceDcwMode,
				aceDcwScaler,
				aceDcwHighScaler,
				aceDcwWavelet,
				aceThinking,
				aceAutoDuration,
				initialDirectorPlan: true,
				roomSlug,
			};
		}
	};

	const handleStart = async () => {
		if (!prompt.trim() || !model.trim()) return;
		setStatusMessage("");
		try {
			const data = await preparePlaylistData();
			if (playbackMode === "room" && onCreatePlaylistInRoom) {
				await onCreatePlaylistInRoom(data);
			} else {
				await onCreatePlaylist(data);
			}
		} catch {
			setStatusMessage("Failed to start playlist. Please try again.");
		} finally {
			setLoading(false);
			setLoadingState("");
		}
	};

	const isRoom = playbackMode === "room";
	const canStart =
		prompt.trim() &&
		model.trim() &&
		!loading &&
		(isRoom ? roomName.trim() : true);

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
			<div className="w-full max-w-2xl">
				{/* Header */}
				<div className="text-center mb-8">
					<h1 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase">
						INFINITUNE
					</h1>
					<p className="mt-2 text-sm uppercase tracking-widest text-white/30">
						INFINITE GENERATIVE MUSIC {"//"} AI-POWERED
					</p>
				</div>

				{/* Main card */}
				<div className="border-4 border-white/20 bg-black">
					<div className="border-b-4 border-white/20 px-4 py-3 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<VinylIcon size={16} className="text-red-500" />
							<span className="text-sm font-black uppercase tracking-widest">
								NEW PLAYLIST
							</span>
						</div>
						<div className="flex items-center gap-3">
							{onOpenHouse && (
								<button
									type="button"
									className="flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-green-500"
									onClick={onOpenHouse}
								>
									<Radio className="h-4 w-4" />
									[HOUSE]
								</button>
							)}
							{onOpenOneshot && (
								<button
									type="button"
									className="flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-yellow-500"
									onClick={onOpenOneshot}
								>
									<Zap className="h-4 w-4" />
									[ONESHOT]
								</button>
							)}
							{onOpenLibrary && (
								<button
									type="button"
									className="flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-blue-500"
									onClick={onOpenLibrary}
								>
									<Library className="h-4 w-4" />
									[LIBRARY]
								</button>
							)}
							<button
								type="button"
								className="flex items-center gap-1 font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
								onClick={onOpenSettings}
							>
								<GearIcon size={16} />
								[SETTINGS]
							</button>
						</div>
					</div>

					<div className="p-6 space-y-6">
						{/* Prompt */}
						<div>
							<p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
								DESCRIBE YOUR MUSIC
							</p>
							<Textarea
								className="min-h-[120px] rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-white/40 resize-none"
								placeholder="GERMAN ROCK LIKE RAMMSTEIN MEETS LINKIN PARK WITH HEAVY INDUSTRIAL BEATS..."
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
							/>
							<button
								type="button"
								className={`mt-2 flex items-center gap-1 font-mono text-xs font-bold uppercase transition-colors ${
									enhancing
										? "text-yellow-500 animate-pulse"
										: "text-white/40 hover:text-red-500"
								}`}
								onClick={handleEnhancePrompt}
								disabled={!prompt.trim() || !model.trim() || enhancing}
							>
								<SparklesIcon size={12} />
								{enhancing ? "[ENHANCING...]" : "[ENHANCE PROMPT]"}
							</button>
						</div>

						{/* Model selection */}
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
									PROVIDER
								</p>
								<div className="flex gap-0">
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
											provider === "openai-codex"
												? "bg-white text-black"
												: "bg-transparent text-white hover:bg-white/10"
										}`}
										onClick={() => setProvider("openai-codex")}
									>
										OPENAI CODEX
									</button>
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
											provider === "anthropic"
												? "bg-white text-black"
												: "bg-transparent text-white hover:bg-white/10"
										}`}
										onClick={() => setProvider("anthropic")}
									>
										ANTHROPIC
									</button>
								</div>
							</div>

							<div>
								<p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
									TEXT MODEL
								</p>
								{provider === "openai-codex" && codexTextModels.length > 0 ? (
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
											provider === "openai-codex"
												? DEFAULT_OPENAI_CODEX_TEXT_MODEL.toUpperCase()
												: DEFAULT_ANTHROPIC_TEXT_MODEL.toUpperCase()
										}
										value={model}
										onChange={(e) => setModel(e.target.value)}
									/>
								)}
							</div>
						</div>

						{/* Playback mode toggle */}
						{onCreatePlaylistInRoom && (
							<div>
								<p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
									PLAYBACK
								</p>
								<div className="flex gap-0">
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors flex items-center justify-center gap-2 ${
											!isRoom
												? "bg-red-500 text-white border-red-500"
												: "bg-transparent text-white/50 hover:bg-white/5"
										}`}
										onClick={() => setPlaybackMode("local")}
									>
										<Headphones className="h-3.5 w-3.5" />
										LOCAL
									</button>
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors flex items-center justify-center gap-2 ${
											isRoom
												? "bg-green-600 text-white border-green-600"
												: "bg-transparent text-white/50 hover:bg-white/5"
										}`}
										onClick={() => setPlaybackMode("room")}
									>
										<Radio className="h-3.5 w-3.5" />
										ROOM
									</button>
								</div>

								{/* Room name input — slides in when room mode */}
								<div
									className={`grid transition-all duration-200 ${
										isRoom
											? "grid-rows-[1fr] opacity-100 mt-3"
											: "grid-rows-[0fr] opacity-0"
									}`}
								>
									<div className="overflow-hidden">
										<div className="flex items-center gap-2">
											<Monitor className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
											<Input
												className="h-9 rounded-none border-2 border-green-600/30 bg-green-600/5 font-mono text-sm font-bold uppercase text-green-400 placeholder:text-green-600/30 focus-visible:ring-0 focus-visible:border-green-500"
												placeholder="ROOM NAME"
												value={roomName}
												onChange={(e) => {
													setRoomName(e.target.value);
													setRoomNameEdited(true);
												}}
											/>
											<span className="text-[10px] text-white/20 font-mono whitespace-nowrap">
												/{slugify(roomName || "room")}
											</span>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* Start button */}
						<Button
							className={`w-full h-14 rounded-none border-4 font-mono text-lg font-black uppercase text-white disabled:opacity-30 transition-colors ${
								isRoom
									? "border-green-600/40 bg-green-600 hover:bg-white hover:text-black hover:border-white"
									: "border-white/20 bg-red-500 hover:bg-white hover:text-black hover:border-white"
							}`}
							onClick={handleStart}
							disabled={!canStart}
						>
							{loading
								? loadingState || ">>> DIRECTOR PLANNING <<<"
								: isRoom
									? ">>> PLAN ROOM <<<"
									: ">>> PLAN PLAYLIST <<<"}
						</Button>
						{statusMessage && (
							<p className="text-center text-[10px] uppercase tracking-widest text-yellow-300 mt-2">
								{statusMessage}
							</p>
						)}
					</div>
				</div>

				{/* Previous Playlists button */}
				{onOpenPlaylists && (
					<div className="mt-6">
						<button
							type="button"
							className="w-full border-4 border-white/20 bg-black px-4 py-3 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
							onClick={onOpenPlaylists}
						>
							<List className="h-4 w-4 text-white/40" />
							<span className="text-sm font-black uppercase tracking-widest text-white/60">
								PREVIOUS PLAYLISTS
							</span>
						</button>
					</div>
				)}

				<p className="mt-4 text-center text-[10px] uppercase tracking-widest text-white/10">
					INFINITUNE V1.0 {"//"} POWERED BY ACE-STEP 1.5
				</p>
			</div>
		</div>
	);
}
