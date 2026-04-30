import {
	DEFAULT_INFERENCE_SH_IMAGE_MODEL,
	INFERENCE_SH_IMAGE_MODELS,
} from "@infinitune/shared/inference-sh-image-models";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CoverImage } from "@/components/autoplayer/CoverImage";
import {
	CollapsibleJson,
	formatElapsed,
} from "@/components/autoplayer/test/shared";
import COMFYUI_WORKFLOW from "@/data/comfyui-workflow-z-image-turbo.json";
import { useSettings } from "@/integrations/api/hooks";
import type { SongCover } from "@/types";

export const Route = createFileRoute("/autoplayer_/testlab/cover")({
	component: CoverTestPage,
});

interface CoverGeneration {
	id: number;
	timestamp: number;
	elapsed: number;
	provider: string;
	model: string;
	prompt: string;
	cover: SongCover | null;
	rawResponse: unknown;
	error: string | null;
}

function CoverTestPage() {
	const settings = useSettings();

	const [coverPrompt, setCoverPrompt] = useState(
		"cinematic matte painting, neon-drenched cyberpunk cityscape at midnight, towering holographic advertisements reflecting off rain-slicked streets, moody blue and magenta lighting, atmospheric fog, dystopian beauty",
	);
	const [provider, setProvider] = useState<
		"comfyui" | "inference-sh" | "codex-imagegen"
	>("comfyui");
	const [model, setModel] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [generations, setGenerations] = useState<CoverGeneration[]>([]);

	// Sync provider from settings
	useEffect(() => {
		if (settings) {
			const p =
				settings.imageProvider === "inference-sh" ||
				settings.imageProvider === "openrouter"
					? "inference-sh"
					: settings.imageProvider === "codex-imagegen"
						? "codex-imagegen"
						: "comfyui";
			setProvider(p);
			if (settings.imageModel) {
				setModel(settings.imageModel);
			} else if (p === "inference-sh") {
				setModel(DEFAULT_INFERENCE_SH_IMAGE_MODEL);
			}
		}
	}, [settings]);

	const handleGenerate = useCallback(async () => {
		setIsRunning(true);
		const startedAt = Date.now();

		try {
			const input: Record<string, string> = {
				coverPrompt,
				provider,
			};
			if (provider === "inference-sh") input.model = model;

			const res = await fetch("/api/autoplayer/generate-cover", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			});

			const elapsed = Date.now() - startedAt;
			const data = await res.json();

			if (!res.ok || data.error) {
				setGenerations((prev) => [
					{
						id: Date.now(),
						timestamp: startedAt,
						elapsed,
						provider,
						model,
						prompt: coverPrompt,
						cover: null,
						rawResponse: data,
						error: data.error || `HTTP ${res.status}`,
					},
					...prev,
				]);
				return;
			}

			setGenerations((prev) => [
				{
					id: Date.now(),
					timestamp: startedAt,
					elapsed,
					provider,
					model,
					prompt: coverPrompt,
					cover: data.cover || null,
					rawResponse: {
						jxl: Boolean(data.cover?.jxlUrl),
						webp: Boolean(data.cover?.webpUrl),
						png: Boolean(data.cover?.pngUrl),
					},
					error: null,
				},
				...prev,
			]);
		} catch (e: unknown) {
			setGenerations((prev) => [
				{
					id: Date.now(),
					timestamp: Date.now(),
					elapsed: Date.now() - startedAt,
					provider,
					model,
					prompt: coverPrompt,
					cover: null,
					rawResponse: null,
					error: e instanceof Error ? e.message : String(e),
				},
				...prev,
			]);
		} finally {
			setIsRunning(false);
		}
	}, [coverPrompt, provider, model]);

	return (
		<div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
			{/* CONFIG */}
			<section className="border-4 border-white/10 bg-black">
				<div className="border-b-2 border-white/10 px-4 py-2">
					<span className="text-xs font-black uppercase tracking-widest text-white/40">
						COVER ART GENERATION
					</span>
				</div>
				<div className="p-4 space-y-4">
					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
						<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
							Cover Prompt
						</label>
						<textarea
							className="w-full h-32 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white p-2 focus:outline-none focus:border-yellow-500"
							value={coverPrompt}
							onChange={(e) => setCoverPrompt(e.target.value)}
							disabled={isRunning}
						/>
					</div>

					<div className="grid grid-cols-2 gap-4">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Provider
							</label>
							<div className="flex gap-2">
								<button
									type="button"
									className={`flex-1 h-8 border-4 font-mono text-[10px] font-black uppercase ${
										provider === "comfyui"
											? "border-yellow-500 bg-yellow-500/10 text-yellow-500"
											: "border-white/10 text-white/40"
									}`}
									onClick={() => setProvider("comfyui")}
									disabled={isRunning}
								>
									ComfyUI
								</button>
								<button
									type="button"
									className={`flex-1 h-8 border-4 font-mono text-[10px] font-black uppercase ${
										provider === "inference-sh"
											? "border-yellow-500 bg-yellow-500/10 text-yellow-500"
											: "border-white/10 text-white/40"
									}`}
									onClick={() => {
										setProvider("inference-sh");
										if (!model) setModel(DEFAULT_INFERENCE_SH_IMAGE_MODEL);
									}}
									disabled={isRunning}
								>
									Inference.sh
								</button>
								<button
									type="button"
									className={`flex-1 h-8 border-4 font-mono text-[10px] font-black uppercase ${
										provider === "codex-imagegen"
											? "border-yellow-500 bg-yellow-500/10 text-yellow-500"
											: "border-white/10 text-white/40"
									}`}
									onClick={() => setProvider("codex-imagegen")}
									disabled={isRunning}
								>
									Codex
								</button>
							</div>
						</div>

						{provider === "inference-sh" && (
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
									Model
								</label>
								<select
									className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
									value={model}
									onChange={(e) => setModel(e.target.value)}
									disabled={isRunning}
								>
									{INFERENCE_SH_IMAGE_MODELS.map((entry) => (
										<option key={entry.id} value={entry.id}>
											{entry.name} - {entry.priceLabel}
										</option>
									))}
								</select>
							</div>
						)}
					</div>

					<button
						type="button"
						className={`w-full h-10 border-4 font-mono text-xs font-black uppercase transition-colors ${
							isRunning
								? "border-white/10 bg-white/5 text-white/20 cursor-not-allowed"
								: "border-white/20 bg-green-600 text-white hover:bg-green-500"
						}`}
						onClick={handleGenerate}
						disabled={isRunning}
					>
						{isRunning ? (
							<span className="flex items-center justify-center gap-2">
								<Loader2 className="h-3 w-3 animate-spin" />
								GENERATING...
							</span>
						) : (
							"[GENERATE]"
						)}
					</button>
				</div>
			</section>

			{/* WORKFLOW INFO */}
			<section className="border-4 border-white/10 bg-black">
				<div className="border-b-2 border-white/10 px-4 py-2">
					<span className="text-xs font-black uppercase tracking-widest text-white/40">
						WORKFLOW
					</span>
				</div>
				<div className="p-4">
					<CollapsibleJson
						label="COMFYUI WORKFLOW (z-image-turbo)"
						data={COMFYUI_WORKFLOW}
					/>
				</div>
			</section>

			{/* GENERATIONS GRID */}
			{generations.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-sm font-black uppercase tracking-widest text-red-500 border-b-2 border-white/10 pb-1">
						GENERATIONS ({generations.length})
					</h2>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{generations.map((gen) => (
							<div
								key={gen.id}
								className={`border-4 bg-black ${gen.error ? "border-red-500/40" : "border-green-600/30"}`}
							>
								<div className="px-4 py-2 flex items-center justify-between border-b-2 border-white/10">
									<span
										className={`px-2 py-0.5 text-[10px] font-black uppercase ${gen.error ? "bg-red-600 text-white" : "bg-green-600 text-white"}`}
									>
										{gen.error ? "ERROR" : "OK"}
									</span>
									<div className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/30">
										<span>{gen.provider}</span>
										<span>{formatElapsed(gen.elapsed)}</span>
									</div>
								</div>

								<div className="p-4 space-y-3">
									{gen.error && (
										<p className="text-[10px] font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
											{gen.error}
										</p>
									)}

									{gen.cover && (
										<CoverImage
											cover={gen.cover}
											alt="Generated cover"
											className="w-full aspect-square border-4 border-white/20 object-cover"
										/>
									)}

									<p className="text-[10px] font-mono text-white/30 line-clamp-3">
										{gen.prompt}
									</p>

									<CollapsibleJson
										label="RAW RESPONSE"
										data={gen.rawResponse}
									/>
								</div>
							</div>
						))}
					</div>
				</section>
			)}
		</div>
	);
}
