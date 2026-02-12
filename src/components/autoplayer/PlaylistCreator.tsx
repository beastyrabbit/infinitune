import { useQuery } from "convex/react";
import { Library, List, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { api } from "../../../convex/_generated/api";
import type { LlmProvider } from "../../../convex/types";

interface ModelOption {
	name: string;
	type?: string;
	vision?: boolean;
}

interface PlaylistCreatorProps {
	onCreatePlaylist: (data: {
		name: string;
		prompt: string;
		provider: LlmProvider;
		model: string;
		inferenceSteps?: number;
		lmTemperature?: number;
		lmCfgScale?: number;
		inferMethod?: string;
	}) => void;
	onOpenSettings: () => void;
	onOpenLibrary?: () => void;
	onOpenOneshot?: () => void;
	onOpenPlaylists?: () => void;
}

export function PlaylistCreator({
	onCreatePlaylist,
	onOpenSettings,
	onOpenLibrary,
	onOpenOneshot,
	onOpenPlaylists,
}: PlaylistCreatorProps) {
	const [prompt, setPrompt] = useState("");
	const [provider, setProvider] = useState<LlmProvider>("ollama");
	const [model, setModel] = useState("");
	const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
	const [loading, setLoading] = useState(false);
	const [enhancing, setEnhancing] = useState(false);
	const [loadingState, setLoadingState] = useState("");
	const modelSetByUserOrSettings = useRef(false);

	const settings = useQuery(api.settings.getAll);

	// Apply defaults from settings once loaded — takes priority over ollama fallback
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

	useEffect(() => {
		fetch("/api/autoplayer/ollama-models")
			.then((r) => r.json())
			.then((d) => {
				const allModels = d.models || [];
				setOllamaModels(allModels);
				// Only auto-pick a model if settings didn't already provide one
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
			.catch((e) => console.warn("Failed to fetch Ollama models:", e));
	}, []);

	const textModels = ollamaModels.filter(
		(m) => m.type === "text" || (!m.type && !m.vision),
	);

	const handleEnhancePrompt = async () => {
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
				if (data.result) {
					setPrompt(data.result);
				}
			}
		} catch {
			// Silently fail — user still has original prompt
		} finally {
			setEnhancing(false);
		}
	};

	const handleStart = async () => {
		if (!prompt.trim() || !model.trim()) return;
		setLoading(true);
		setLoadingState(">>> ANALYZING PROMPT <<<");

		// Read generation defaults from settings
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

		try {
			// Call enhance-session to get AI-determined params (only inferenceSteps used)
			const res = await fetch("/api/autoplayer/enhance-session", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ prompt: prompt.trim(), provider, model }),
			});

			let enhancedParams: Record<string, unknown> = {};
			if (res.ok) {
				enhancedParams = await res.json();
			}

			setLoadingState(">>> INITIALIZING <<<");

			const name = prompt.trim().slice(0, 50);
			onCreatePlaylist({
				name,
				prompt: prompt.trim(),
				provider,
				model,
				inferenceSteps:
					(enhancedParams.inferenceSteps as number | undefined) ??
					inferenceSteps,
				lmTemperature,
				lmCfgScale,
				inferMethod,
			});
		} catch {
			// If enhance-session fails, still create playlist with settings defaults
			const name = prompt.trim().slice(0, 50);
			onCreatePlaylist({
				name,
				prompt: prompt.trim(),
				provider,
				model,
				inferenceSteps,
				lmTemperature,
				lmCfgScale,
				inferMethod,
			});
		}
	};

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
			<div className="w-full max-w-2xl">
				{/* Header */}
				<div className="text-center mb-8">
					<h1 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase">
						AUTOPLAYER
					</h1>
					<p className="mt-2 text-sm uppercase tracking-widest text-white/30">
						AI-GENERATED MUSIC {"//"} INFINITE PLAYBACK
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
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
								DESCRIBE YOUR MUSIC
							</label>
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
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2 block">
									PROVIDER
								</label>
								<div className="flex gap-0">
									<button
										type="button"
										className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
											provider === "ollama"
												? "bg-white text-black"
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
												? "bg-white text-black"
												: "bg-transparent text-white hover:bg-white/10"
										}`}
										onClick={() => setProvider("openrouter")}
									>
										OPENROUTER
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
								) : (
									<Input
										className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
										placeholder={
											provider === "openrouter"
												? "GOOGLE/GEMINI-2.5-FLASH"
												: "LLAMA3.1:8B"
										}
										value={model}
										onChange={(e) => setModel(e.target.value)}
									/>
								)}
							</div>
						</div>

						{/* Start button */}
						<Button
							className="w-full h-14 rounded-none border-4 border-white/20 bg-red-500 font-mono text-lg font-black uppercase text-white hover:bg-white hover:text-black hover:border-white disabled:opacity-30"
							onClick={handleStart}
							disabled={!prompt.trim() || !model.trim() || loading}
						>
							{loading
								? loadingState || ">>> INITIALIZING <<<"
								: ">>> START LISTENING <<<"}
						</Button>
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
					AUTOPLAYER V1.0 {"//"} POWERED BY ACE-STEP 1.5
				</p>
			</div>
		</div>
	);
}
