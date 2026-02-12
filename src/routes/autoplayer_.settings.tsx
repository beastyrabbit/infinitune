import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Cpu, Music, Plug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsTabAudioEngine } from "@/components/autoplayer/settings/SettingsTabAudioEngine";
import type {
	ModelOption,
	OpenRouterModelOption,
} from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabModels } from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabNetwork } from "@/components/autoplayer/settings/SettingsTabNetwork";
import type { TestStatus } from "@/components/autoplayer/settings/TestButton";
import { Button } from "@/components/ui/button";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/autoplayer_/settings")({
	component: SettingsPage,
	validateSearch: validatePlaylistKeySearch,
});

type Tab = "network" | "models" | "audio";

const TABS: { id: Tab; label: string; icon: typeof Plug }[] = [
	{ id: "network", label: "NETWORK", icon: Plug },
	{ id: "models", label: "MODELS", icon: Cpu },
	{ id: "audio", label: "AUDIO ENGINE", icon: Music },
];

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

	// Tab state
	const [activeTab, setActiveTab] = useState<Tab>("network");

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
	const [openRouterTextModels, setOpenRouterTextModels] = useState<
		OpenRouterModelOption[]
	>([]);
	const [openRouterImageModels, setOpenRouterImageModels] = useState<
		OpenRouterModelOption[]
	>([]);
	const [openRouterLoading, setOpenRouterLoading] = useState(false);

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

	// Fetch Ollama + ACE models on mount
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

	// Fetch OpenRouter models when provider is selected + key exists
	useEffect(() => {
		const needsOpenRouter =
			textProvider === "openrouter" || imageProvider === "openrouter";
		if (!needsOpenRouter || !openrouterApiKey) {
			setOpenRouterTextModels([]);
			setOpenRouterImageModels([]);
			return;
		}

		setOpenRouterLoading(true);
		Promise.all([
			fetch("/api/autoplayer/openrouter-models?type=text")
				.then((r) => r.json())
				.then((d) => d.models || [])
				.catch(() => []),
			fetch("/api/autoplayer/openrouter-models?type=image")
				.then((r) => r.json())
				.then((d) => d.models || [])
				.catch(() => []),
		]).then(([text, image]) => {
			setOpenRouterTextModels(text);
			setOpenRouterImageModels(image);
			setOpenRouterLoading(false);
		});
	}, [textProvider, imageProvider, openrouterApiKey]);

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
			setSetting({ key: "aceInferenceSteps", value: inferSteps }),
			setSetting({ key: "aceLmTemperature", value: lmTemp }),
			setSetting({ key: "aceLmCfgScale", value: lmCfg }),
			setSetting({ key: "aceInferMethod", value: inferMethod }),
		];

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

			<div className="max-w-5xl mx-auto px-4 py-8">
				{/* Mobile: horizontal tab strip */}
				<div className="flex gap-0 md:hidden mb-6">
					{TABS.map((tab, i) => {
						const Icon = tab.icon;
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								className={`flex-1 h-10 border-4 border-white/20 font-mono text-[10px] font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
									i > 0 ? "border-l-0" : ""
								} ${
									isActive
										? "bg-white text-black"
										: "bg-transparent text-white/60 hover:bg-white/10"
								}`}
								onClick={() => setActiveTab(tab.id)}
							>
								<Icon size={12} />
								{tab.label}
								{tab.id === "audio" && activePlaylist && (
									<span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
								)}
							</button>
						);
					})}
				</div>

				{/* Desktop: sidebar + panel grid */}
				<div className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
					{/* Desktop sidebar — hidden on mobile */}
					<nav className="hidden md:flex md:flex-col gap-1">
						{TABS.map((tab) => {
							const Icon = tab.icon;
							const isActive = activeTab === tab.id;
							return (
								<button
									key={tab.id}
									type="button"
									className={`w-full h-10 px-3 border-4 border-white/20 font-mono text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-2 ${
										isActive
											? "bg-white text-black"
											: "bg-transparent text-white/60 hover:bg-white/10 hover:text-white"
									}`}
									onClick={() => setActiveTab(tab.id)}
								>
									<Icon size={14} />
									{tab.label}
									{tab.id === "audio" && activePlaylist && (
										<span className="ml-auto w-2 h-2 rounded-full bg-yellow-500" />
									)}
								</button>
							);
						})}
					</nav>

					{/* Content panel */}
					<div className="min-w-0">
						{activeTab === "network" && (
							<SettingsTabNetwork
								ollamaUrl={ollamaUrl}
								setOllamaUrl={setOllamaUrl}
								aceStepUrl={aceStepUrl}
								setAceStepUrl={setAceStepUrl}
								comfyuiUrl={comfyuiUrl}
								setComfyuiUrl={setComfyuiUrl}
								openrouterApiKey={openrouterApiKey}
								setOpenrouterApiKey={setOpenrouterApiKey}
								ollamaTest={ollamaTest}
								aceTest={aceTest}
								comfyuiTest={comfyuiTest}
								openrouterTest={openrouterTest}
								onTest={testConnection}
							/>
						)}

						{activeTab === "models" && (
							<SettingsTabModels
								textProvider={textProvider}
								setTextProvider={setTextProvider}
								textModel={textModel}
								setTextModel={setTextModel}
								imageProvider={imageProvider}
								setImageProvider={setImageProvider}
								imageModel={imageModel}
								setImageModel={setImageModel}
								aceModel={aceModel}
								setAceModel={setAceModel}
								ollamaModels={ollamaModels}
								aceModels={aceModels}
								openRouterTextModels={openRouterTextModels}
								openRouterImageModels={openRouterImageModels}
								openRouterLoading={openRouterLoading}
							/>
						)}

						{activeTab === "audio" && (
							<SettingsTabAudioEngine
								inferSteps={inferSteps}
								setInferSteps={setInferSteps}
								lmTemp={lmTemp}
								setLmTemp={setLmTemp}
								lmCfg={lmCfg}
								setLmCfg={setLmCfg}
								inferMethod={inferMethod}
								setInferMethod={setInferMethod}
								activePlaylist={!!activePlaylist}
							/>
						)}

						{/* SAVE — always visible below content */}
						<div className="mt-8">
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
				</div>
			</div>
		</div>
	);
}
