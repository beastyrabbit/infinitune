import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/autoplayer_/settings")({
	component: SettingsPage,
	validateSearch: validatePlaylistKeySearch,
});

interface ModelOption {
	name: string;
	is_default?: boolean;
	vision?: boolean;
	type?: string;
}

type TestStatus =
	| { state: "idle" }
	| { state: "testing" }
	| { state: "ok"; message: string }
	| { state: "error"; message: string };

function SettingsPage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const settings = useQuery(api.settings.getAll);
	const setSetting = useMutation(api.settings.set);
	const activePlaylist = useQuery(
		api.playlists.getByPlaylistKey,
		pl ? { playlistKey: pl } : "skip",
	);
	const updateParams = useMutation(api.playlists.updateParams);

	// Generation params
	const [inferSteps, setInferSteps] = useState("12");
	const [lmTemp, setLmTemp] = useState("0.85");
	const [lmCfg, setLmCfg] = useState("2.5");
	const [inferMethod, setInferMethod] = useState("ode");

	// Service URLs
	const [ollamaUrl, setOllamaUrl] = useState("http://192.168.10.120:11434");
	const [aceStepUrl, setAceStepUrl] = useState("http://192.168.10.120:8001");
	const [comfyuiUrl, setComfyuiUrl] = useState("http://192.168.10.120:8188");

	// Model settings
	const [textProvider, setTextProvider] = useState("ollama");
	const [textModel, setTextModel] = useState("");
	const [imageProvider, setImageProvider] = useState("comfyui");
	const [imageModel, setImageModel] = useState("");
	const [aceModel, setAceModel] = useState("");
	const [openrouterApiKey, setOpenrouterApiKey] = useState("");

	// Available models
	const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
	const [aceModels, setAceModels] = useState<ModelOption[]>([]);

	// Test statuses
	const [ollamaTest, setOllamaTest] = useState<TestStatus>({ state: "idle" });
	const [openrouterTest, setOpenrouterTest] = useState<TestStatus>({
		state: "idle",
	});
	const [comfyuiTest, setComfyuiTest] = useState<TestStatus>({ state: "idle" });
	const [aceTest, setAceTest] = useState<TestStatus>({ state: "idle" });

	const [saved, setSaved] = useState(false);

	// Load settings from Convex
	useEffect(() => {
		if (!settings) return;
		setOllamaUrl(settings.ollamaUrl || "http://192.168.10.120:11434");
		setAceStepUrl(settings.aceStepUrl || "http://192.168.10.120:8001");
		setComfyuiUrl(settings.comfyuiUrl || "http://192.168.10.120:8188");
		setTextProvider(settings.textProvider || "ollama");
		setTextModel(settings.textModel || "");
		const imgProv = settings.imageProvider || "comfyui";
		setImageProvider(imgProv === "ollama" ? "comfyui" : imgProv);
		setImageModel(settings.imageModel || "");
		setAceModel(settings.aceModel || "");
		setOpenrouterApiKey(settings.openrouterApiKey || "");

		// Generation params: prefer active playlist values, fall back to global settings
		if (activePlaylist) {
			setInferSteps(
				activePlaylist.inferenceSteps?.toString() ||
					settings.aceInferenceSteps ||
					"12",
			);
			setLmTemp(
				activePlaylist.lmTemperature?.toString() ||
					settings.aceLmTemperature ||
					"0.85",
			);
			setLmCfg(
				activePlaylist.lmCfgScale?.toString() ||
					settings.aceLmCfgScale ||
					"2.5",
			);
			setInferMethod(
				activePlaylist.inferMethod || settings.aceInferMethod || "ode",
			);
		} else {
			setInferSteps(settings.aceInferenceSteps || "12");
			setLmTemp(settings.aceLmTemperature || "0.85");
			setLmCfg(settings.aceLmCfgScale || "2.5");
			setInferMethod(settings.aceInferMethod || "ode");
		}
	}, [settings, activePlaylist]);

	// Fetch available models on mount
	useEffect(() => {
		fetch("/api/autoplayer/ollama-models")
			.then((r) => r.json())
			.then((d) => setOllamaModels(d.models || []))
			.catch(() => {});

		fetch("/api/autoplayer/ace-models")
			.then((r) => r.json())
			.then((d) => setAceModels(d.models || []))
			.catch(() => {});
	}, []);

	const textModels = ollamaModels.filter(
		(m) => m.type === "text" || (!m.type && !m.vision),
	);

	const testConnection = useCallback(
		async (provider: string) => {
			const setStatus =
				provider === "ollama"
					? setOllamaTest
					: provider === "openrouter"
						? setOpenrouterTest
						: provider === "comfyui"
							? setComfyuiTest
							: setAceTest;

			setStatus({ state: "testing" });
			try {
				const res = await fetch("/api/autoplayer/test-connection", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ provider, apiKey: openrouterApiKey }),
				});
				const data = await res.json();
				if (data.ok) {
					setStatus({ state: "ok", message: data.message });
				} else {
					setStatus({ state: "error", message: data.error });
				}
			} catch {
				setStatus({ state: "error", message: "Request failed" });
			}
		},
		[openrouterApiKey],
	);

	const save = async () => {
		const promises: Promise<unknown>[] = [
			setSetting({ key: "ollamaUrl", value: ollamaUrl }),
			setSetting({ key: "aceStepUrl", value: aceStepUrl }),
			setSetting({ key: "comfyuiUrl", value: comfyuiUrl }),
			setSetting({ key: "textProvider", value: textProvider }),
			setSetting({ key: "textModel", value: textModel }),
			setSetting({ key: "imageProvider", value: imageProvider }),
			setSetting({ key: "imageModel", value: imageModel }),
			setSetting({ key: "aceModel", value: aceModel }),
			setSetting({ key: "openrouterApiKey", value: openrouterApiKey }),
			// Generation param defaults
			setSetting({ key: "aceInferenceSteps", value: inferSteps }),
			setSetting({ key: "aceLmTemperature", value: lmTemp }),
			setSetting({ key: "aceLmCfgScale", value: lmCfg }),
			setSetting({ key: "aceInferMethod", value: inferMethod }),
		];

		// Also update active playlist if one exists
		if (activePlaylist) {
			promises.push(
				updateParams({
					id: activePlaylist._id,
					inferenceSteps: inferSteps
						? Number.parseInt(inferSteps, 10)
						: undefined,
					lmTemperature: lmTemp ? Number.parseFloat(lmTemp) : undefined,
					lmCfgScale: lmCfg ? Number.parseFloat(lmCfg) : undefined,
					inferMethod: inferMethod || undefined,
				}),
			);
		}

		await Promise.all(promises);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	// biome-ignore lint/correctness/noNestedComponentDefinitions: small helper component tightly coupled to parent state
	const TestButton = ({
		provider,
		status,
	}: {
		provider: string;
		status: TestStatus;
	}) => (
		<div className="flex items-center gap-2">
			<button
				type="button"
				className="font-mono text-[10px] font-black uppercase tracking-wider text-white/40 hover:text-yellow-400 transition-colors"
				onClick={() => testConnection(provider)}
				disabled={status.state === "testing"}
			>
				{status.state === "testing" ? "[TESTING...]" : "[TEST]"}
			</button>
			{status.state === "ok" && (
				<span className="text-[10px] font-bold uppercase text-green-400">
					{status.message}
				</span>
			)}
			{status.state === "error" && (
				<span className="text-[10px] font-bold uppercase text-red-400">
					{status.message}
				</span>
			)}
		</div>
	);

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
						SETTINGS
					</h1>
					<button
						type="button"
						className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
						onClick={() =>
							navigate({ to: "/autoplayer", search: (prev) => prev })
						}
					>
						[BACK]
					</button>
				</div>
			</header>

			<div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
				{/* SERVICE URLS */}
				<section>
					<h3 className="text-sm font-black uppercase tracking-widest text-red-500 mb-4 border-b-2 border-white/10 pb-1">
						SERVICE ENDPOINTS
					</h3>
					<div className="space-y-4">
						<div>
							<div className="flex items-center justify-between mb-1">
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40">
									Ollama URL
								</label>
								<TestButton provider="ollama" status={ollamaTest} />
							</div>
							<Input
								className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0"
								placeholder="http://192.168.10.120:11434"
								value={ollamaUrl}
								onChange={(e) => setOllamaUrl(e.target.value)}
							/>
						</div>
						<div>
							<div className="flex items-center justify-between mb-1">
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40">
									ACE-Step URL
								</label>
								<TestButton provider="ace-step" status={aceTest} />
							</div>
							<Input
								className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0"
								placeholder="http://192.168.10.120:8001"
								value={aceStepUrl}
								onChange={(e) => setAceStepUrl(e.target.value)}
							/>
						</div>
						<div>
							<div className="flex items-center justify-between mb-1">
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40">
									ComfyUI URL
								</label>
								<TestButton provider="comfyui" status={comfyuiTest} />
							</div>
							<Input
								className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0"
								placeholder="http://192.168.10.120:8188"
								value={comfyuiUrl}
								onChange={(e) => setComfyuiUrl(e.target.value)}
							/>
						</div>
					</div>
				</section>

				{/* TEXT MODEL */}
				<section>
					<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
							TEXT MODEL — LYRICS & METADATA
						</h3>
					</div>
					<div className="space-y-3">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Provider
							</label>
							<div className="flex gap-0">
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										textProvider === "ollama"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setTextProvider("ollama")}
								>
									OLLAMA
								</button>
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										textProvider === "openrouter"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setTextProvider("openrouter")}
								>
									OPENROUTER
								</button>
							</div>
						</div>
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Model
							</label>
							{textProvider === "ollama" && textModels.length > 0 ? (
								<Select value={textModel} onValueChange={setTextModel}>
									<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
										<SelectValue placeholder="SELECT MODEL" />
									</SelectTrigger>
									<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
										{textModels.map((m) => (
											<SelectItem
												key={m.name}
												value={m.name}
												className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
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
										textProvider === "openrouter"
											? "GOOGLE/GEMINI-2.5-FLASH"
											: "LLAMA3.1:8B"
									}
									value={textModel}
									onChange={(e) => setTextModel(e.target.value)}
								/>
							)}
						</div>
					</div>
				</section>

				{/* IMAGE MODEL */}
				<section>
					<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
							IMAGE MODEL — COVER ART
						</h3>
					</div>
					<div className="space-y-3">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Provider
							</label>
							<div className="flex gap-0">
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										imageProvider === "comfyui"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setImageProvider("comfyui")}
								>
									COMFYUI
								</button>
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										imageProvider === "openrouter"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setImageProvider("openrouter")}
								>
									OPENROUTER
								</button>
							</div>
						</div>
						{imageProvider === "comfyui" ? (
							<div>
								<p className="text-[10px] font-bold uppercase text-white/30 mt-1">
									USING BUILT-IN Z-IMAGE-TURBO (LUMINA2) WORKFLOW — 4 STEPS,
									496x496, WEBSOCKET
								</p>
							</div>
						) : (
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
									Model
								</label>
								<Input
									className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
									placeholder="OPENAI/DALL-E-3"
									value={imageModel}
									onChange={(e) => setImageModel(e.target.value)}
								/>
							</div>
						)}
					</div>
				</section>

				{/* ACE-STEP MODEL */}
				<section>
					<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
							ACE-STEP — AUDIO GENERATION
						</h3>
					</div>
					<div className="space-y-3">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Model
							</label>
							{aceModels.length > 0 ? (
								<Select value={aceModel} onValueChange={setAceModel}>
									<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
										<SelectValue placeholder="DEFAULT" />
									</SelectTrigger>
									<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
										<SelectItem
											value="__default__"
											className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
										>
											DEFAULT
										</SelectItem>
										{aceModels.map((m) => (
											<SelectItem
												key={m.name}
												value={m.name}
												className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
											>
												{m.name.toUpperCase()}
												{m.is_default ? " (DEFAULT)" : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<Input
									className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
									placeholder="ACESTEP-V15-TURBO"
									value={aceModel}
									onChange={(e) => setAceModel(e.target.value)}
								/>
							)}
						</div>
					</div>
				</section>

				{/* ACE-STEP GENERATION PARAMS */}
				<section>
					<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
							ACE-STEP GENERATION PARAMS
						</h3>
						{activePlaylist && (
							<span className="text-[10px] font-black uppercase tracking-wider text-yellow-500 animate-pulse">
								EDITING ACTIVE PLAYLIST
							</span>
						)}
					</div>
					<div className="space-y-4">
						{/* Inference Steps */}
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Inference Steps
							</label>
							<Input
								className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
								placeholder="12"
								value={inferSteps}
								onChange={(e) => {
									if (e.target.value === "" || /^\d+$/.test(e.target.value))
										setInferSteps(e.target.value);
								}}
							/>
							<p className="mt-1 text-[10px] font-bold uppercase text-white/20">
								4-16 — HIGHER = BETTER QUALITY, SLOWER
							</p>
						</div>

						{/* LM Temperature + CFG Scale — side by side */}
						<div className="grid grid-cols-2 gap-3">
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
									LM Temperature
								</label>
								<Input
									className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
									placeholder="0.85"
									value={lmTemp}
									onChange={(e) => {
										if (
											e.target.value === "" ||
											/^\d*\.?\d*$/.test(e.target.value)
										)
											setLmTemp(e.target.value);
									}}
								/>
								<p className="mt-1 text-[10px] font-bold uppercase text-white/20">
									0.1-1.5 — HIGHER = MORE CREATIVE
								</p>
							</div>
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
									LM CFG Scale
								</label>
								<Input
									className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
									placeholder="2.5"
									value={lmCfg}
									onChange={(e) => {
										if (
											e.target.value === "" ||
											/^\d*\.?\d*$/.test(e.target.value)
										)
											setLmCfg(e.target.value);
									}}
								/>
								<p className="mt-1 text-[10px] font-bold uppercase text-white/20">
									1.0-5.0 — HIGHER = FOLLOW PROMPT MORE
								</p>
							</div>
						</div>

						{/* Diffusion Method */}
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Diffusion Method
							</label>
							<div className="flex gap-0">
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										inferMethod === "ode"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setInferMethod("ode")}
								>
									ODE (FASTER)
								</button>
								<button
									type="button"
									className={`flex-1 h-10 border-4 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
										inferMethod === "sde"
											? "bg-white text-black"
											: "bg-transparent text-white hover:bg-white/10"
									}`}
									onClick={() => setInferMethod("sde")}
								>
									SDE (STOCHASTIC)
								</button>
							</div>
						</div>
					</div>
				</section>

				{/* API KEYS */}
				<section>
					<div className="flex items-center justify-between mb-4 border-b-2 border-white/10 pb-1">
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
							API KEYS
						</h3>
						<TestButton provider="openrouter" status={openrouterTest} />
					</div>
					<div className="space-y-3">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								OpenRouter API Key
							</label>
							<Input
								type="password"
								className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0"
								placeholder="sk-or-..."
								value={openrouterApiKey}
								onChange={(e) => setOpenrouterApiKey(e.target.value)}
							/>
						</div>
					</div>
				</section>

				{/* SAVE */}
				<Button
					className={`w-full h-12 rounded-none border-4 font-mono text-sm font-black uppercase transition-colors ${
						saved
							? "border-green-500/40 bg-green-500 text-white"
							: "border-white/20 bg-red-500 text-white hover:bg-white hover:text-black"
					}`}
					onClick={save}
				>
					{saved ? "SAVED" : "SAVE SETTINGS"}
				</Button>
			</div>
		</div>
	);
}
