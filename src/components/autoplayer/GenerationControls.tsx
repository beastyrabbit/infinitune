import { useMutation } from "convex/react";
import {
	Clock,
	Gauge,
	Globe,
	Music,
	Piano,
	Sliders,
	Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";

const LANGUAGES = [
	{ value: "auto", label: "Auto" },
	{ value: "english", label: "English" },
	{ value: "german", label: "German" },
	{ value: "spanish", label: "Spanish" },
	{ value: "french", label: "French" },
	{ value: "korean", label: "Korean" },
	{ value: "japanese", label: "Japanese" },
	{ value: "russian", label: "Russian" },
] as const;

interface SessionData {
	_id: string;
	prompt: string;
	llmProvider: string;
	llmModel: string;
	lyricsLanguage?: string;
	targetBpm?: number;
	targetKey?: string;
	timeSignature?: string;
	audioDuration?: number;
	inferenceSteps?: number;
	lmTemperature?: number;
	lmCfgScale?: number;
	inferMethod?: string;
}

interface GenerationControlsProps {
	session: SessionData;
}

export function GenerationControls({ session }: GenerationControlsProps) {
	const updateParams = useMutation(api.sessions.updateParams);
	const updatePrompt = useMutation(api.sessions.updatePrompt);
	const resetDefaults = useMutation(api.sessions.resetDefaults);

	const [prompt, setPromptValue] = useState(session.prompt);
	const [language, setLanguage] = useState(session.lyricsLanguage || "auto");
	const [bpm, setBpm] = useState(session.targetBpm?.toString() || "");
	const [key, setKey] = useState(session.targetKey || "");
	const [timeSig, setTimeSig] = useState(session.timeSignature || "");
	const [duration, setDuration] = useState(
		session.audioDuration?.toString() || "",
	);
	const [steps, setSteps] = useState(
		session.inferenceSteps?.toString() || "12",
	);
	const [lmTemp, setLmTemp] = useState(
		session.lmTemperature?.toString() || "0.85",
	);
	const [lmCfg, setLmCfg] = useState(
		session.lmCfgScale?.toString() || "2.5",
	);
	const [inferMeth, setInferMeth] = useState(
		session.inferMethod || "ode",
	);

	const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>(
		{},
	);

	// Sync from session when Convex pushes updates (e.g. after reset)
	useEffect(() => {
		setPromptValue(session.prompt);
		setLanguage(session.lyricsLanguage || "auto");
		setBpm(session.targetBpm?.toString() || "");
		setKey(session.targetKey || "");
		setTimeSig(session.timeSignature || "");
		setDuration(session.audioDuration?.toString() || "");
		setSteps(session.inferenceSteps?.toString() || "12");
		setLmTemp(session.lmTemperature?.toString() || "0.85");
		setLmCfg(session.lmCfgScale?.toString() || "2.5");
		setInferMeth(session.inferMethod || "ode");
	}, [session._id, session.inferenceSteps, session.lmTemperature, session.lmCfgScale, session.inferMethod, session.lyricsLanguage, session.targetBpm, session.targetKey, session.timeSignature, session.audioDuration]);

	const debouncedUpdate = (field: string, value: unknown) => {
		if (debounceRefs.current[field])
			clearTimeout(debounceRefs.current[field]);
		debounceRefs.current[field] = setTimeout(() => {
			updateParams({ id: session._id as any, [field]: value });
		}, 500);
	};

	const handleLanguageChange = (value: string) => {
		setLanguage(value);
		debouncedUpdate("lyricsLanguage", value);
	};

	const handleBpmChange = (value: string) => {
		if (value !== "" && !/^\d+$/.test(value)) return;
		setBpm(value);
		const num = value ? Number.parseInt(value, 10) : undefined;
		debouncedUpdate("targetBpm", num);
	};

	const handleKeyChange = (value: string) => {
		setKey(value);
		debouncedUpdate("targetKey", value || undefined);
	};

	const handleTimeSigChange = (value: string) => {
		setTimeSig(value);
		debouncedUpdate("timeSignature", value || undefined);
	};

	const handleDurationChange = (value: string) => {
		if (value !== "" && !/^\d+$/.test(value)) return;
		setDuration(value);
		const num = value ? Number.parseInt(value, 10) : undefined;
		debouncedUpdate("audioDuration", num);
	};

	const handleStepsChange = (value: string) => {
		if (value !== "" && !/^\d+$/.test(value)) return;
		setSteps(value);
		const num = value ? Number.parseInt(value, 10) : undefined;
		debouncedUpdate("inferenceSteps", num);
	};

	const handleLmTempChange = (value: string) => {
		if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
		setLmTemp(value);
		const num = value ? Number.parseFloat(value) : undefined;
		debouncedUpdate("lmTemperature", num);
	};

	const handleLmCfgChange = (value: string) => {
		if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
		setLmCfg(value);
		const num = value ? Number.parseFloat(value) : undefined;
		debouncedUpdate("lmCfgScale", num);
	};

	const handleInferMethodChange = (value: string) => {
		setInferMeth(value);
		debouncedUpdate("inferMethod", value);
	};

	const handleResetDefaults = () => {
		setBpm("");
		setKey("");
		setTimeSig("");
		setDuration("");
		setSteps("12");
		setLmTemp("0.85");
		setLmCfg("2.5");
		setInferMeth("ode");
		setLanguage("auto");
		resetDefaults({ id: session._id as any });
	};

	const handleUpdatePrompt = () => {
		const trimmed = prompt.trim();
		if (!trimmed || trimmed === session.prompt) return;
		updatePrompt({ id: session._id as any, prompt: trimmed });
	};

	return (
		<div className="flex flex-col bg-gray-950 p-6 overflow-y-auto">
			<div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">
				GENERATION CONTROLS
			</div>

			{/* Prompt editor (absorbed from PlaylistConfig) */}
			<div className="mb-6">
				<label className="flex items-center gap-2 text-sm font-bold uppercase text-white/60 mb-2">
					<Music className="h-4 w-4" />
					SESSION PROMPT
				</label>
				<textarea
					value={prompt}
					onChange={(e) => setPromptValue(e.target.value)}
					className="w-full min-h-[80px] rounded-none border-4 border-white/20 bg-gray-900 px-3 py-2 font-mono text-sm font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none resize-none"
				/>
				<div className="flex items-center justify-between mt-2">
					<div className="text-[10px] font-bold uppercase text-white/20">
						{session.llmModel.toUpperCase()} /{" "}
						{session.llmProvider.toUpperCase()}
					</div>
					<Button
						className="h-8 rounded-none border-2 border-white/20 bg-red-500 font-mono text-xs font-black uppercase text-white hover:bg-white hover:text-black hover:border-white"
						onClick={handleUpdatePrompt}
						disabled={
							!prompt.trim() || prompt.trim() === session.prompt
						}
					>
						UPDATE
					</Button>
				</div>
			</div>

			{/* Language */}
			<div className="mb-4">
				<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
					<Globe className="h-3 w-3" />
					LYRICS LANGUAGE
				</label>
				<select
					value={language}
					onChange={(e) => handleLanguageChange(e.target.value)}
					className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white focus:border-red-500 focus:outline-none"
				>
					{LANGUAGES.map((lang) => (
						<option key={lang.value} value={lang.value}>
							{lang.label}
						</option>
					))}
				</select>
			</div>

			{/* BPM + Key — side by side */}
			<div className="grid grid-cols-2 gap-3 mb-4">
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						<Gauge className="h-3 w-3" />
						BPM
					</label>
					<input
						type="text"
						inputMode="numeric"
						value={bpm}
						onChange={(e) => handleBpmChange(e.target.value)}
						placeholder="AUTO"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
				</div>
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						<Piano className="h-3 w-3" />
						KEY
					</label>
					<input
						type="text"
						value={key}
						onChange={(e) => handleKeyChange(e.target.value)}
						placeholder="AUTO"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
				</div>
			</div>

			{/* Time Sig + Duration — side by side */}
			<div className="grid grid-cols-2 gap-3 mb-4">
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						<Sliders className="h-3 w-3" />
						TIME SIG
					</label>
					<input
						type="text"
						value={timeSig}
						onChange={(e) => handleTimeSigChange(e.target.value)}
						placeholder="4/4"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
				</div>
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						<Clock className="h-3 w-3" />
						DURATION (S)
					</label>
					<input
						type="text"
						inputMode="numeric"
						value={duration}
						onChange={(e) => handleDurationChange(e.target.value)}
						placeholder="AUTO"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
				</div>
			</div>

			{/* Inference Steps */}
			<div className="mb-4">
				<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
					<Wand2 className="h-3 w-3" />
					INFERENCE STEPS
				</label>
				<input
					type="text"
					inputMode="numeric"
					value={steps}
					onChange={(e) => handleStepsChange(e.target.value)}
					placeholder="12"
					className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
				/>
				<p className="mt-1 text-[10px] text-white/20 uppercase">
					4-16 — HIGHER = BETTER QUALITY, SLOWER
				</p>
			</div>

			{/* LM Temperature + CFG Scale — side by side */}
			<div className="grid grid-cols-2 gap-3 mb-4">
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						LM TEMP
					</label>
					<input
						type="text"
						inputMode="decimal"
						value={lmTemp}
						onChange={(e) => handleLmTempChange(e.target.value)}
						placeholder="0.85"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
					<p className="mt-1 text-[10px] text-white/20 uppercase">
						0.1-1.5 — HIGHER = MORE CREATIVE
					</p>
				</div>
				<div>
					<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
						LM CFG
					</label>
					<input
						type="text"
						inputMode="decimal"
						value={lmCfg}
						onChange={(e) => handleLmCfgChange(e.target.value)}
						placeholder="2.5"
						className="w-full h-9 rounded-none border-2 border-white/20 bg-gray-900 px-2 font-mono text-xs font-bold uppercase text-white placeholder:text-white/20 focus:border-red-500 focus:outline-none"
					/>
					<p className="mt-1 text-[10px] text-white/20 uppercase">
						1.0-5.0 — HIGHER = FOLLOW PROMPT MORE
					</p>
				</div>
			</div>

			{/* Infer Method */}
			<div className="mb-4">
				<label className="flex items-center gap-2 text-xs font-bold uppercase text-white/50 mb-1">
					DIFFUSION METHOD
				</label>
				<div className="flex gap-0">
					<button
						className={`flex-1 h-9 border-2 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
							inferMeth === "ode"
								? "bg-white text-black"
								: "bg-transparent text-white hover:bg-white/10"
						}`}
						onClick={() => handleInferMethodChange("ode")}
					>
						ODE (FASTER)
					</button>
					<button
						className={`flex-1 h-9 border-2 border-l-0 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
							inferMeth === "sde"
								? "bg-white text-black"
								: "bg-transparent text-white hover:bg-white/10"
						}`}
						onClick={() => handleInferMethodChange("sde")}
					>
						SDE (STOCHASTIC)
					</button>
				</div>
			</div>

			{/* Footer */}
			<div className="mt-auto border-t-2 border-white/10 pt-3 flex items-center justify-between">
				<div className="text-[10px] text-white/20 uppercase">
					Changes apply to all future songs
				</div>
				<button
					className="text-[10px] font-black uppercase text-white/30 hover:text-red-500 transition-colors"
					onClick={handleResetDefaults}
				>
					[RESET DEFAULTS]
				</button>
			</div>
		</div>
	);
}
