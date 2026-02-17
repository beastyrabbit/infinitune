import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SettingsField, SettingsPanel } from "./SettingsPanel";

export interface ModelOption {
	name: string;
	displayName?: string;
	is_default?: boolean;
	vision?: boolean;
	type?: string;
	inputModalities?: string[];
}

export interface OpenRouterModelOption {
	id: string;
	name: string;
	promptPrice: string;
	completionPrice: string;
	contextLength: number;
}

export interface ModelsTabProps {
	textProvider: string;
	setTextProvider: (v: string) => void;
	textModel: string;
	setTextModel: (v: string) => void;
	imageProvider: string;
	setImageProvider: (v: string) => void;
	imageModel: string;
	setImageModel: (v: string) => void;
	aceModel: string;
	setAceModel: (v: string) => void;
	personaProvider: string;
	setPersonaProvider: (v: string) => void;
	personaModel: string;
	setPersonaModel: (v: string) => void;
	ollamaModels: ModelOption[];
	aceModels: ModelOption[];
	openRouterTextModels: OpenRouterModelOption[];
	openRouterImageModels: OpenRouterModelOption[];
	openRouterLoading: boolean;
	codexModels: ModelOption[];
	codexLoading: boolean;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0";

function ProviderToggle({
	options,
	value,
	onChange,
}: {
	options: { value: string; label: string }[];
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="flex gap-0">
			{options.map((opt, i) => (
				<button
					key={opt.value}
					type="button"
					className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
						i > 0 ? "border-l-0" : ""
					} ${
						value === opt.value
							? "bg-white text-black"
							: "bg-transparent text-white hover:bg-white/10"
					}`}
					onClick={() => onChange(opt.value)}
				>
					{opt.label}
				</button>
			))}
		</div>
	);
}

function PricingStrip({ model }: { model: OpenRouterModelOption }) {
	const promptPerM = Number.parseFloat(model.promptPrice) * 1_000_000;
	const completionPerM = Number.parseFloat(model.completionPrice) * 1_000_000;
	const ctxK = Math.round(model.contextLength / 1000);

	return (
		<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
			${promptPerM.toFixed(2)}/M IN · ${completionPerM.toFixed(2)}/M OUT ·{" "}
			{ctxK}K CTX
		</p>
	);
}

function OpenRouterModelSelect({
	models,
	value,
	onChange,
	placeholder,
	loading,
}: {
	models: OpenRouterModelOption[];
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	loading: boolean;
}) {
	const [filter, setFilter] = useState("");

	const filtered = useMemo(() => {
		if (!filter) return models;
		const q = filter.toLowerCase();
		return models.filter(
			(m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
		);
	}, [models, filter]);

	const selectedModel = models.find((m) => m.id === value);

	// Validate manually typed model IDs against the fetched list
	const isManualEntry = value && !selectedModel && models.length > 0;

	if (loading) {
		return (
			<div className="h-10 rounded-none border-4 border-white/20 bg-gray-900 flex items-center px-3">
				<span className="font-mono text-xs font-bold uppercase text-white/40 animate-pulse">
					LOADING MODELS...
				</span>
			</div>
		);
	}

	if (models.length === 0) {
		return (
			<div>
				<Input
					className={inputClass}
					placeholder={placeholder}
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
				<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
					SET API KEY IN NETWORK TAB TO LOAD MODEL LIST
				</p>
			</div>
		);
	}

	return (
		<div>
			<div className="relative">
				<Input
					className={inputClass}
					placeholder={`FILTER ${models.length} MODELS...`}
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
				/>
			</div>
			<div className="mt-1 max-h-48 overflow-y-auto border-4 border-white/20 bg-gray-900 scrollbar-thin scrollbar-thumb-white/20">
				{filtered.slice(0, 50).map((m) => (
					<button
						key={m.id}
						type="button"
						className={`w-full text-left px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
							value === m.id
								? "bg-white text-black font-black"
								: "text-white/70 hover:bg-white/10 hover:text-white"
						}`}
						onClick={() => {
							onChange(m.id);
							setFilter("");
						}}
					>
						{m.id}
					</button>
				))}
				{filtered.length > 50 && (
					<p className="px-3 py-1.5 text-[10px] font-bold uppercase text-white/30">
						{filtered.length - 50} MORE — REFINE FILTER
					</p>
				)}
				{filtered.length === 0 && (
					<p className="px-3 py-1.5 text-[10px] font-bold uppercase text-white/30">
						NO MATCHES
					</p>
				)}
			</div>

			{/* Current selection display */}
			{value && (
				<div className="mt-1 flex items-center gap-2">
					<span className="font-mono text-xs font-bold uppercase text-white/60">
						{value}
					</span>
					{isManualEntry ? (
						<span className="text-[10px] font-black uppercase text-red-400">
							✗ NOT FOUND
						</span>
					) : selectedModel ? (
						<span className="text-[10px] font-black uppercase text-green-400">
							✓ VALID
						</span>
					) : null}
				</div>
			)}

			{selectedModel && <PricingStrip model={selectedModel} />}
		</div>
	);
}

export function SettingsTabModels({
	textProvider,
	setTextProvider,
	textModel,
	setTextModel,
	imageProvider,
	setImageProvider,
	imageModel,
	setImageModel,
	aceModel,
	setAceModel,
	personaProvider,
	setPersonaProvider,
	personaModel,
	setPersonaModel,
	ollamaModels,
	aceModels,
	openRouterTextModels,
	openRouterImageModels,
	openRouterLoading,
	codexModels,
	codexLoading,
}: ModelsTabProps) {
	const textModels = ollamaModels.filter(
		(m) => m.type === "text" || (!m.type && !m.vision),
	);
	const codexTextModels = codexModels.filter(
		(m) => m.type === "text" || m.inputModalities?.includes("text"),
	);

	return (
		<div className="space-y-8">
			{/* TEXT MODEL */}
			<SettingsPanel title="TEXT MODEL — LYRICS & METADATA">
				<SettingsField label="Provider">
					<ProviderToggle
						options={[
							{ value: "ollama", label: "OLLAMA" },
							{ value: "openrouter", label: "OPENROUTER" },
							{ value: "openai-codex", label: "OPENAI CODEX" },
						]}
						value={textProvider}
						onChange={setTextProvider}
					/>
				</SettingsField>

				<SettingsField label="Model">
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
					) : textProvider === "openrouter" ? (
						<OpenRouterModelSelect
							models={openRouterTextModels}
							value={textModel}
							onChange={setTextModel}
							placeholder="GOOGLE/GEMINI-2.5-FLASH"
							loading={openRouterLoading}
						/>
					) : textProvider === "openai-codex" ? (
						codexLoading ? (
							<div className="h-10 rounded-none border-4 border-white/20 bg-gray-900 flex items-center px-3">
								<span className="font-mono text-xs font-bold uppercase text-white/40 animate-pulse">
									LOADING CODEX MODELS...
								</span>
							</div>
						) : codexTextModels.length > 0 ? (
							<Select value={textModel} onValueChange={setTextModel}>
								<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
									<SelectValue placeholder="SELECT CODEX MODEL" />
								</SelectTrigger>
								<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
									{codexTextModels.map((m) => (
										<SelectItem
											key={m.name}
											value={m.name}
											className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
										>
											{(m.displayName || m.name).toUpperCase()}
											{m.is_default ? " (DEFAULT)" : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<div>
								<Input
									className={inputClass}
									placeholder="GPT-5.3-CODEX"
									value={textModel}
									onChange={(e) => setTextModel(e.target.value)}
								/>
								<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
									SIGN IN ON NETWORK TAB TO LOAD CODEX MODEL LIST
								</p>
							</div>
						)
					) : (
						<Input
							className={inputClass}
							placeholder="LLAMA3.1:8B"
							value={textModel}
							onChange={(e) => setTextModel(e.target.value)}
						/>
					)}
				</SettingsField>
			</SettingsPanel>

			{/* IMAGE MODEL */}
			<SettingsPanel title="IMAGE MODEL — COVER ART">
				<SettingsField label="Provider">
					<ProviderToggle
						options={[
							{ value: "comfyui", label: "COMFYUI" },
							{ value: "openrouter", label: "OPENROUTER" },
						]}
						value={imageProvider}
						onChange={setImageProvider}
					/>
				</SettingsField>

				{imageProvider === "comfyui" ? (
					<p className="text-[10px] font-bold uppercase text-white/30">
						USING BUILT-IN Z-IMAGE-TURBO (LUMINA2) WORKFLOW — 4 STEPS, 496x496,
						WEBSOCKET
					</p>
				) : (
					<SettingsField label="Model">
						<OpenRouterModelSelect
							models={openRouterImageModels}
							value={imageModel}
							onChange={setImageModel}
							placeholder="OPENAI/DALL-E-3"
							loading={openRouterLoading}
						/>
					</SettingsField>
				)}
			</SettingsPanel>

			{/* ACE-STEP MODEL */}
			<SettingsPanel title="ACE-STEP — AUDIO GENERATION">
				<SettingsField label="Model">
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
							className={inputClass}
							placeholder="ACESTEP-V15-TURBO"
							value={aceModel}
							onChange={(e) => setAceModel(e.target.value)}
						/>
					)}
				</SettingsField>
			</SettingsPanel>

			{/* PERSONA MODEL */}
			<SettingsPanel title="PERSONA MODEL — SONG DNA EXTRACTION">
				<SettingsField label="Provider">
					<ProviderToggle
						options={[
							{ value: "ollama", label: "OLLAMA" },
							{ value: "openrouter", label: "OPENROUTER" },
							{ value: "openai-codex", label: "OPENAI CODEX" },
						]}
						value={personaProvider}
						onChange={setPersonaProvider}
					/>
				</SettingsField>

				<SettingsField label="Model">
					{personaProvider === "ollama" && textModels.length > 0 ? (
						<Select
							value={personaModel || "__fallback__"}
							onValueChange={(value) =>
								setPersonaModel(value === "__fallback__" ? "" : value)
							}
						>
							<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
								<SelectValue placeholder="USES TEXT MODEL IF EMPTY" />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								<SelectItem
									value="__fallback__"
									className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
								>
									USE TEXT MODEL
								</SelectItem>
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
					) : personaProvider === "openrouter" ? (
						<OpenRouterModelSelect
							models={openRouterTextModels}
							value={personaModel}
							onChange={setPersonaModel}
							placeholder="USES TEXT MODEL IF EMPTY"
							loading={openRouterLoading}
						/>
					) : personaProvider === "openai-codex" ? (
						codexLoading ? (
							<div className="h-10 rounded-none border-4 border-white/20 bg-gray-900 flex items-center px-3">
								<span className="font-mono text-xs font-bold uppercase text-white/40 animate-pulse">
									LOADING CODEX MODELS...
								</span>
							</div>
						) : codexTextModels.length > 0 ? (
							<Select
								value={personaModel || "__fallback__"}
								onValueChange={(value) =>
									setPersonaModel(value === "__fallback__" ? "" : value)
								}
							>
								<SelectTrigger className="w-full h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white">
									<SelectValue placeholder="USES TEXT MODEL IF EMPTY" />
								</SelectTrigger>
								<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
									<SelectItem
										value="__fallback__"
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										USE TEXT MODEL
									</SelectItem>
									{codexTextModels.map((m) => (
										<SelectItem
											key={m.name}
											value={m.name}
											className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
										>
											{(m.displayName || m.name).toUpperCase()}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Input
								className={inputClass}
								placeholder="USES TEXT MODEL IF EMPTY"
								value={personaModel}
								onChange={(e) => setPersonaModel(e.target.value)}
							/>
						)
					) : (
						<Input
							className={inputClass}
							placeholder="USES TEXT MODEL IF EMPTY"
							value={personaModel}
							onChange={(e) => setPersonaModel(e.target.value)}
						/>
					)}
				</SettingsField>

				<p className="text-[10px] font-bold uppercase text-white/30">
					EXTRACTS MUSICAL DNA FROM LIKED SONGS. FALLS BACK TO TEXT MODEL IF NOT
					SET.
				</p>
			</SettingsPanel>
		</div>
	);
}
