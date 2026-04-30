import {
	AGENT_REASONING_LABELS,
	AGENT_REASONING_LEVELS,
	type AgentReasoningLevel,
	DEFAULT_AGENT_REASONING_LEVELS,
	INFINITUNE_AGENT_IDS,
	type InfinituneAgentId,
} from "@infinitune/shared/agent-reasoning";
import {
	DEFAULT_ANTHROPIC_TEXT_MODEL,
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
} from "@infinitune/shared/text-llm-profile";
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

export interface InferenceShImageModelOption {
	id: string;
	name: string;
	priceLabel: string;
	pricePerImageUsd?: number;
	description: string;
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
	agentReasoning: Record<InfinituneAgentId, AgentReasoningLevel>;
	setAgentReasoningLevel: (
		agentId: InfinituneAgentId,
		level: AgentReasoningLevel,
	) => void;
	aceModels: ModelOption[];
	inferenceShImageModels: InferenceShImageModelOption[];
	inferenceShLoading: boolean;
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

function PriceStrip({ model }: { model: InferenceShImageModelOption }) {
	return (
		<p className="mt-1 text-[10px] font-bold uppercase text-white/30">
			{model.priceLabel} · {model.description}
		</p>
	);
}

function InferenceShModelSelect({
	models,
	value,
	onChange,
	placeholder,
	loading,
}: {
	models: InferenceShImageModelOption[];
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
					INFERENCE.SH MODEL LIST IS UNAVAILABLE
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
						<span className="block font-black">{m.name}</span>
						<span className="block text-[10px] opacity-70">
							{m.id} · {m.priceLabel}
						</span>
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

			{selectedModel && <PriceStrip model={selectedModel} />}
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
	agentReasoning,
	setAgentReasoningLevel,
	aceModels,
	inferenceShImageModels,
	inferenceShLoading,
	codexModels,
	codexLoading,
}: ModelsTabProps) {
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
							{ value: "openai-codex", label: "OPENAI CODEX" },
							{ value: "anthropic", label: "ANTHROPIC" },
						]}
						value={textProvider}
						onChange={setTextProvider}
					/>
				</SettingsField>

				<SettingsField label="Model">
					{textProvider === "openai-codex" ? (
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
									placeholder={DEFAULT_OPENAI_CODEX_TEXT_MODEL.toUpperCase()}
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
							placeholder={DEFAULT_ANTHROPIC_TEXT_MODEL.toUpperCase()}
							value={textModel}
							onChange={(e) => setTextModel(e.target.value)}
						/>
					)}
				</SettingsField>
			</SettingsPanel>

			{/* PI AGENT REASONING */}
			<SettingsPanel title="PI AGENT REASONING">
				<p className="text-[10px] font-bold uppercase leading-relaxed text-white/35">
					SET THINKING DEPTH BY ROLE. KEEP DIRECTORS AND CRITICS HIGHER; USE
					LOWER LEVELS FOR LIGHTER CREATIVE NOTES.
				</p>
				<div className="grid gap-2">
					{INFINITUNE_AGENT_IDS.map((agentId) => {
						const meta = AGENT_REASONING_LABELS[agentId];
						const value =
							agentReasoning[agentId] ??
							DEFAULT_AGENT_REASONING_LEVELS[agentId];
						return (
							<div
								key={agentId}
								className="grid gap-2 border-4 border-white/10 bg-black/30 p-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center"
							>
								<div className="min-w-0">
									<p className="font-mono text-xs font-black uppercase text-white">
										{meta.label}
									</p>
									<p className="mt-1 text-[10px] font-bold uppercase leading-relaxed text-white/35">
										{meta.description}
									</p>
								</div>
								<ProviderToggle
									options={AGENT_REASONING_LEVELS.map((level) => ({
										value: level,
										label: level === "xhigh" ? "XHIGH" : level.toUpperCase(),
									}))}
									value={value}
									onChange={(next) =>
										setAgentReasoningLevel(agentId, next as AgentReasoningLevel)
									}
								/>
							</div>
						);
					})}
				</div>
			</SettingsPanel>

			{/* IMAGE MODEL */}
			<SettingsPanel title="IMAGE MODEL — COVER ART">
				<SettingsField label="Provider">
					<ProviderToggle
						options={[
							{ value: "comfyui", label: "COMFYUI" },
							{ value: "inference-sh", label: "INFERENCE.SH" },
							{ value: "codex-imagegen", label: "CODEX" },
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
				) : imageProvider === "codex-imagegen" ? (
					<p className="text-[10px] font-bold uppercase text-white/30">
						USES CODEX CLI $IMAGEGEN WITH GPT-IMAGE-2 — COUNTS AGAINST CODEX
						USAGE LIMITS, NOT OPENAI API BILLING
					</p>
				) : (
					<SettingsField label="Model">
						<InferenceShModelSelect
							models={inferenceShImageModels}
							value={imageModel}
							onChange={setImageModel}
							placeholder="PRUNA/FLUX-KLEIN-4B"
							loading={inferenceShLoading}
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
							{ value: "openai-codex", label: "OPENAI CODEX" },
							{ value: "anthropic", label: "ANTHROPIC" },
						]}
						value={personaProvider}
						onChange={setPersonaProvider}
					/>
				</SettingsField>

				<SettingsField label="Model">
					{personaProvider === "openai-codex" ? (
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
