import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	CollapsibleJson,
	formatElapsed,
} from "@/components/autoplayer/test/shared";
import { api } from "../../convex/_generated/api";
import { SONG_SCHEMA, SYSTEM_PROMPT } from "./api.autoplayer.generate-song";

export const Route = createFileRoute("/autoplayer_/test/llm")({
	component: LlmTestPage,
});

interface Generation {
	id: number;
	timestamp: number;
	elapsed: number;
	provider: string;
	model: string;
	prompt: string;
	result: Record<string, unknown> | null;
	error: string | null;
}

function LlmTestPage() {
	const settings = useQuery(api.settings.getAll);

	const [prompt, setPrompt] = useState("upbeat electronic dance music");
	const [provider, setProvider] = useState<"ollama" | "openrouter">("ollama");
	const [model, setModel] = useState("");
	const [ollamaModels, setOllamaModels] = useState<string[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const [generations, setGenerations] = useState<Generation[]>([]);
	const [expandedId, setExpandedId] = useState<number | null>(null);

	// Sync provider/model from settings
	useEffect(() => {
		if (settings) {
			const p =
				settings.textProvider === "openrouter" ? "openrouter" : "ollama";
			setProvider(p);
			if (settings.textModel) setModel(settings.textModel);
		}
	}, [settings]);

	// Fetch Ollama models
	useEffect(() => {
		if (provider !== "ollama") return;
		fetch("/api/autoplayer/ollama-models")
			.then((r) => r.json())
			.then((data) => {
				const names = (data.models || [])
					.filter((m: unknown) => (m as { type: string }).type === "text")
					.map((m: unknown) => (m as { name: string }).name);
				setOllamaModels(names);
				if (names.length > 0 && !model) setModel(names[0]);
			})
			.catch(() => {});
	}, [provider, model]);

	const handleGenerate = useCallback(async () => {
		setIsRunning(true);
		const startedAt = Date.now();

		try {
			const input = {
				provider,
				model,
				systemPrompt: SYSTEM_PROMPT,
				userPrompt: prompt,
				schema: SONG_SCHEMA,
				structuredOutput:
					provider === "ollama"
						? "format (JSON schema)"
						: "response_format (json_schema)",
			};

			const res = await fetch("/api/autoplayer/generate-song", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			});

			const elapsed = Date.now() - startedAt;

			if (!res.ok) {
				const errText = await res.text();
				const gen: Generation = {
					id: Date.now(),
					timestamp: startedAt,
					elapsed,
					provider,
					model,
					prompt,
					result: null,
					error: `HTTP ${res.status}: ${errText}`,
				};
				setGenerations((prev) => [gen, ...prev]);
				setExpandedId(gen.id);
				return;
			}

			const data = await res.json();
			if (data.error) {
				const gen: Generation = {
					id: Date.now(),
					timestamp: startedAt,
					elapsed,
					provider,
					model,
					prompt,
					result: null,
					error: data.error,
				};
				setGenerations((prev) => [gen, ...prev]);
				setExpandedId(gen.id);
				return;
			}

			const gen: Generation = {
				id: Date.now(),
				timestamp: startedAt,
				elapsed,
				provider,
				model,
				prompt,
				result: data,
				error: null,
			};
			setGenerations((prev) => [gen, ...prev]);
			setExpandedId(gen.id);
		} catch (e: unknown) {
			const gen: Generation = {
				id: Date.now(),
				timestamp: Date.now(),
				elapsed: Date.now() - startedAt,
				provider,
				model,
				prompt,
				result: null,
				error: e instanceof Error ? e.message : String(e),
			};
			setGenerations((prev) => [gen, ...prev]);
			setExpandedId(gen.id);
		} finally {
			setIsRunning(false);
		}
	}, [provider, model, prompt]);

	return (
		<div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
			{/* CONFIG */}
			<section className="border-4 border-white/10 bg-black">
				<div className="border-b-2 border-white/10 px-4 py-2">
					<span className="text-xs font-black uppercase tracking-widest text-white/40">
						LLM GENERATION
					</span>
				</div>
				<div className="p-4 space-y-4">
					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
						<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
							Prompt
						</label>
						<textarea
							className="w-full h-20 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white p-2 focus:outline-none focus:border-yellow-500"
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
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
										provider === "ollama"
											? "border-yellow-500 bg-yellow-500/10 text-yellow-500"
											: "border-white/10 text-white/40"
									}`}
									onClick={() => setProvider("ollama")}
									disabled={isRunning}
								>
									Ollama
								</button>
								<button
									type="button"
									className={`flex-1 h-8 border-4 font-mono text-[10px] font-black uppercase ${
										provider === "openrouter"
											? "border-yellow-500 bg-yellow-500/10 text-yellow-500"
											: "border-white/10 text-white/40"
									}`}
									onClick={() => setProvider("openrouter")}
									disabled={isRunning}
								>
									OpenRouter
								</button>
							</div>
						</div>

						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Model
							</label>
							{provider === "ollama" ? (
								<select
									className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
									value={model}
									onChange={(e) => setModel(e.target.value)}
									disabled={isRunning}
								>
									{ollamaModels.map((m) => (
										<option key={m} value={m}>
											{m}
										</option>
									))}
								</select>
							) : (
								<input
									className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
									value={model}
									onChange={(e) => setModel(e.target.value)}
									placeholder="e.g. meta-llama/llama-3.3-70b-instruct"
									disabled={isRunning}
								/>
							)}
						</div>
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

			{/* PROMPT VISIBILITY */}
			<section className="border-4 border-white/10 bg-black">
				<div className="border-b-2 border-white/10 px-4 py-2">
					<span className="text-xs font-black uppercase tracking-widest text-white/40">
						PROMPT DETAILS
					</span>
				</div>
				<div className="p-4 space-y-1">
					<CollapsibleJson label="SYSTEM PROMPT" data={SYSTEM_PROMPT} />
					<CollapsibleJson label="JSON SCHEMA" data={SONG_SCHEMA} />
					<div className="mt-2 text-[10px] font-bold uppercase text-white/20">
						Structured output:{" "}
						{provider === "ollama"
							? "Ollama format (JSON schema)"
							: "OpenRouter response_format (json_schema)"}
					</div>
				</div>
			</section>

			{/* GENERATIONS */}
			{generations.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-sm font-black uppercase tracking-widest text-red-500 border-b-2 border-white/10 pb-1">
						GENERATIONS ({generations.length})
					</h2>

					{generations.map((gen) => (
						<div
							key={gen.id}
							className={`border-4 bg-black ${gen.error ? "border-red-500/40" : "border-green-600/30"}`}
						>
							<button
								type="button"
								className="w-full px-4 py-2 flex items-center justify-between border-b-2 border-white/10 text-left"
								onClick={() =>
									setExpandedId(expandedId === gen.id ? null : gen.id)
								}
							>
								<div className="flex items-center gap-2">
									<span
										className={`px-2 py-0.5 text-[10px] font-black uppercase ${gen.error ? "bg-red-600 text-white" : "bg-green-600 text-white"}`}
									>
										{gen.error ? "ERROR" : "OK"}
									</span>
									<span className="text-xs font-black uppercase truncate max-w-xs">
										{String(gen.result?.title || gen.prompt.slice(0, 40))}
									</span>
								</div>
								<div className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/30">
									<span>
										{gen.provider}/{gen.model}
									</span>
									<span>{formatElapsed(gen.elapsed)}</span>
								</div>
							</button>

							{expandedId === gen.id && (
								<div className="p-4 space-y-4">
									{gen.error && (
										<p className="text-[10px] font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
											{gen.error}
										</p>
									)}

									{gen.result && (
										<>
											{/* Metadata card */}
											<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
												<div>
													<span className="font-bold uppercase text-white/40">
														Title:{" "}
													</span>
													<span className="font-black">
														{String(gen.result.title)}
													</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Artist:{" "}
													</span>
													<span className="font-black">
														{String(gen.result.artistName)}
													</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Genre:{" "}
													</span>
													<span>{String(gen.result.genre)}</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Sub-genre:{" "}
													</span>
													<span>{String(gen.result.subGenre)}</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														BPM:{" "}
													</span>
													<span>{String(gen.result.bpm)}</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Key:{" "}
													</span>
													<span>{String(gen.result.keyScale)}</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Time Sig:{" "}
													</span>
													<span>{String(gen.result.timeSignature)}</span>
												</div>
												<div>
													<span className="font-bold uppercase text-white/40">
														Duration:{" "}
													</span>
													<span>{String(gen.result.audioDuration)}s</span>
												</div>
											</div>

											{/* Lyrics */}
											<div>
												<span className="text-[10px] font-black uppercase text-white/40">
													LYRICS
												</span>
												<pre className="mt-1 text-xs font-mono text-white/60 bg-gray-900 border-2 border-white/10 p-3 max-h-48 overflow-auto whitespace-pre-wrap">
													{String(gen.result.lyrics)}
												</pre>
											</div>

											{/* Caption + Cover Prompt */}
											<div className="space-y-2">
												<div>
													<span className="text-[10px] font-black uppercase text-white/40">
														CAPTION:{" "}
													</span>
													<span className="text-xs text-white/60">
														{String(gen.result.caption)}
													</span>
												</div>
												<div>
													<span className="text-[10px] font-black uppercase text-white/40">
														COVER PROMPT:{" "}
													</span>
													<span className="text-xs text-white/60">
														{String(gen.result.coverPrompt)}
													</span>
												</div>
											</div>

											<CollapsibleJson label="RAW JSON" data={gen.result} />
										</>
									)}
								</div>
							)}
						</div>
					))}
				</section>
			)}
		</div>
	);
}
