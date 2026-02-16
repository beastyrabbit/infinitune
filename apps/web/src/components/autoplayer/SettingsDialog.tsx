import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useSetSetting, useSettings } from "@/integrations/api/hooks";
import { API_URL } from "@/lib/endpoints";

interface SettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
	const settings = useSettings();
	const setSetting = useSetSetting();

	const [textProvider, setTextProvider] = useState("ollama");
	const [textModel, setTextModel] = useState("");
	const [imageProvider, setImageProvider] = useState("comfyui");
	const [imageModel, setImageModel] = useState("");
	const [aceModel, setAceModel] = useState("");
	const [openrouterApiKey, setOpenrouterApiKey] = useState("");

	const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
	const [aceModels, setAceModels] = useState<ModelOption[]>([]);

	const [ollamaTest, setOllamaTest] = useState<TestStatus>({ state: "idle" });
	const [openrouterTest, setOpenrouterTest] = useState<TestStatus>({
		state: "idle",
	});
	const [comfyuiTest, setComfyuiTest] = useState<TestStatus>({ state: "idle" });
	const [aceTest, setAceTest] = useState<TestStatus>({ state: "idle" });

	// Load settings from Convex
	useEffect(() => {
		if (!settings) return;
		setTextProvider(settings.textProvider || "ollama");
		setTextModel(settings.textModel || "");
		setImageProvider(settings.imageProvider || "comfyui");
		setImageModel(settings.imageModel || "");
		setAceModel(settings.aceModel || "");
		setOpenrouterApiKey(settings.openrouterApiKey || "");
	}, [settings]);

	// Fetch available models when dialog opens
	useEffect(() => {
		if (!open) return;

		fetch(`${API_URL}/api/autoplayer/ollama-models`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => setOllamaModels(d.models || []))
			.catch((e) => console.warn("Failed to fetch Ollama models:", e));

		fetch(`${API_URL}/api/autoplayer/ace-models`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => setAceModels(d.models || []))
			.catch((e) => console.warn("Failed to fetch ACE models:", e));
	}, [open]);

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
				const res = await fetch(`${API_URL}/api/autoplayer/test-connection`, {
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
		await Promise.all([
			setSetting({ key: "textProvider", value: textProvider }),
			setSetting({ key: "textModel", value: textModel }),
			setSetting({ key: "imageProvider", value: imageProvider }),
			setSetting({ key: "imageModel", value: imageModel }),
			setSetting({ key: "aceModel", value: aceModel }),
			setSetting({ key: "openrouterApiKey", value: openrouterApiKey }),
		]);
		onOpenChange(false);
	};

	// biome-ignore lint/correctness/noNestedComponentDefinitions: uses testConnection from closure
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
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="font-mono bg-gray-950 text-white border-4 border-white/20 rounded-none max-w-2xl max-h-[90vh] overflow-y-auto [&>button]:text-white">
				<DialogHeader>
					<DialogTitle className="text-2xl font-black uppercase tracking-tighter">
						SETTINGS
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-6 mt-4">
					{/* Text Model */}
					<section>
						<div className="flex items-center justify-between mb-3 border-b-2 border-white/10 pb-1">
							<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
								TEXT MODEL — LYRICS & METADATA
							</h3>
						</div>
						<div className="space-y-3">
							<div>
								<div className="flex items-center justify-between mb-1">
									{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
									<label className="text-xs font-bold uppercase text-white/40">
										Provider
									</label>
									{textProvider === "ollama" && (
										<TestButton provider="ollama" status={ollamaTest} />
									)}
									{textProvider === "openrouter" && (
										<TestButton provider="openrouter" status={openrouterTest} />
									)}
								</div>
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

					{/* Image Model */}
					<section>
						<div className="flex items-center justify-between mb-3 border-b-2 border-white/10 pb-1">
							<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
								IMAGE MODEL — COVER ART
							</h3>
							{imageProvider === "comfyui" && (
								<TestButton provider="comfyui" status={comfyuiTest} />
							)}
							{imageProvider === "openrouter" && (
								<TestButton provider="openrouter" status={openrouterTest} />
							)}
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
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
								<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
									Model
								</label>
								{imageProvider === "comfyui" ? (
									<div className="h-10 flex items-center border-4 border-white/20 bg-gray-900 px-3 font-mono text-sm font-bold uppercase text-white/60">
										Z-IMAGE (LUMINA2) — 512×512
									</div>
								) : (
									<Input
										className="h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0"
										placeholder="OPENAI/DALL-E-3"
										value={imageModel}
										onChange={(e) => setImageModel(e.target.value)}
									/>
								)}
							</div>
						</div>
					</section>

					{/* ACE-Step Model */}
					<section>
						<div className="flex items-center justify-between mb-3 border-b-2 border-white/10 pb-1">
							<h3 className="text-sm font-black uppercase tracking-widest text-red-500">
								ACE-STEP — AUDIO GENERATION
							</h3>
							<TestButton provider="ace-step" status={aceTest} />
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

					{/* OpenRouter API Key */}
					<section>
						<h3 className="text-sm font-black uppercase tracking-widest text-red-500 mb-3 border-b-2 border-white/10 pb-1">
							API KEYS
						</h3>
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

					{/* Save */}
					<Button
						className="w-full h-12 rounded-none border-4 border-white/20 bg-red-500 font-mono text-sm font-black uppercase text-white hover:bg-white hover:text-black"
						onClick={save}
					>
						SAVE SETTINGS
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
