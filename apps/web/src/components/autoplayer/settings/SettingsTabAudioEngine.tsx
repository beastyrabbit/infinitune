import {
	ACE_DCW_DEFAULTS,
	ACE_DCW_MODES,
	ACE_GENERATION_DEFAULTS,
} from "@infinitune/shared/ace-settings";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SettingsField, SettingsPanel } from "./SettingsPanel";

export interface AudioEngineTabProps {
	inferSteps: string;
	setInferSteps: (v: string) => void;
	lmTemp: string;
	setLmTemp: (v: string) => void;
	lmCfg: string;
	setLmCfg: (v: string) => void;
	inferMethod: string;
	setInferMethod: (v: string) => void;
	aceThinking: boolean;
	setAceThinking: (v: boolean) => void;
	aceAutoDuration: boolean;
	setAceAutoDuration: (v: boolean) => void;
	aceQueueDepth: string;
	setAceQueueDepth: (v: string) => void;
	aceDcwEnabled: boolean;
	setAceDcwEnabled: (v: boolean) => void;
	aceDcwMode: string;
	setAceDcwMode: (v: string) => void;
	aceDcwScaler: string;
	setAceDcwScaler: (v: string) => void;
	aceDcwHighScaler: string;
	setAceDcwHighScaler: (v: string) => void;
	aceDcwWavelet: string;
	setAceDcwWavelet: (v: string) => void;
	activePlaylist: boolean;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0";

const DEFAULT_INFER_STEPS = String(ACE_GENERATION_DEFAULTS.inferenceSteps);
const DEFAULT_LM_TEMP = String(ACE_GENERATION_DEFAULTS.lmTemperature);
const DEFAULT_LM_CFG = String(ACE_GENERATION_DEFAULTS.lmCfgScale);
const DEFAULT_INFER_METHOD = ACE_GENERATION_DEFAULTS.inferMethod;

const INFERENCE_STEP_OPTIONS = [
	"4",
	"6",
	"8",
	"10",
	"12",
	"14",
	"16",
	"20",
	"24",
	"28",
	"32",
];
const LM_TEMPERATURE_OPTIONS = [
	"0.35",
	"0.5",
	"0.65",
	"0.75",
	"0.85",
	"1.0",
	"1.15",
	"1.3",
	"1.5",
];
const LM_CFG_OPTIONS = ["1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "5.0"];
const ACE_QUEUE_DEPTH_OPTIONS = ["1", "4", "8", "12", "24", "36", "60", "120"];
const DCW_SCALER_OPTIONS = ["0", "0.02", "0.05", "0.08", "0.1", "0.15", "0.2"];
const DCW_HIGH_SCALER_OPTIONS = [
	"0",
	"0.01",
	"0.02",
	"0.03",
	"0.05",
	"0.08",
	"0.1",
];
const WAVELET_OPTIONS = ["haar", "db2", "db4", "sym4", "coif1", "bior2.2"];

interface ToggleOption<T> {
	label: string;
	value: T;
}

function ToggleButtons<T>({
	options,
	value,
	onChange,
}: {
	options: [ToggleOption<T>, ToggleOption<T>];
	value: T;
	onChange: (v: T) => void;
}): React.ReactElement {
	return (
		<div className="flex gap-0">
			{options.map((option, i) => (
				<button
					key={option.label}
					type="button"
					aria-pressed={value === option.value}
					className={`flex-1 h-10 border-4 border-white/20 font-mono text-xs font-black uppercase transition-colors ${
						i > 0 ? "border-l-0" : ""
					} ${
						value === option.value
							? "bg-white text-black"
							: "bg-transparent text-white hover:bg-white/10"
					}`}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function SettingsTabAudioEngine({
	inferSteps,
	setInferSteps,
	lmTemp,
	setLmTemp,
	lmCfg,
	setLmCfg,
	inferMethod,
	setInferMethod,
	aceThinking,
	setAceThinking,
	aceQueueDepth,
	setAceQueueDepth,
	aceDcwEnabled,
	setAceDcwEnabled,
	aceDcwMode,
	setAceDcwMode,
	aceDcwScaler,
	setAceDcwScaler,
	aceDcwHighScaler,
	setAceDcwHighScaler,
	aceDcwWavelet,
	setAceDcwWavelet,
	activePlaylist,
}: AudioEngineTabProps) {
	return (
		<div className="space-y-8">
			<SettingsPanel
				title="ACE-STEP GENERATION PARAMS"
				badge={
					activePlaylist ? (
						<span className="text-[10px] font-black uppercase tracking-wider text-yellow-500 animate-pulse">
							PLAYLIST OVERRIDES
						</span>
					) : undefined
				}
			>
				<SettingsField
					label="ACE Thinking"
					hint="ON = ACE REWRITES CAPTION INTERNALLY, OFF = FASTER, USES LLM OUTPUT AS-IS"
				>
					<ToggleButtons
						options={[
							{ label: "OFF (FASTER)", value: false },
							{ label: "ON", value: true },
						]}
						value={aceThinking}
						onChange={setAceThinking}
					/>
				</SettingsField>

				<SettingsField
					label="Radio Duration Lock"
					hint="GLOBAL RADIO ALWAYS SENDS AUDIO_DURATION=180 AND ACE AUTO DURATION=OFF"
				>
					<div className="flex h-10 items-center border-4 border-white/20 bg-black px-3 font-mono text-sm font-black uppercase text-emerald-200">
						Fixed 3:00 / 180 seconds
					</div>
				</SettingsField>

				<SettingsField
					label="ACE Queue Depth"
					hint="SUBMITTED/POLLING BACKLOG, NOT GPU PARALLELISM. MATCH ACE WORKER CAPACITY FOR RESPONSIVE PRIORITIES"
				>
					<Select
						value={aceQueueDepth || "12"}
						onValueChange={setAceQueueDepth}
					>
						<SelectTrigger className={inputClass}>
							<SelectValue placeholder="12" />
						</SelectTrigger>
						<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
							{ACE_QUEUE_DEPTH_OPTIONS.map((value) => (
								<SelectItem
									key={value}
									value={value}
									className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
								>
									{value === "12" ? "12 TASKS (DEFAULT)" : `${value} TASKS`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsField>

				<SettingsField
					label="Inference Steps"
					hint="4-16 — HIGHER = BETTER QUALITY, SLOWER"
				>
					<Select
						value={inferSteps || DEFAULT_INFER_STEPS}
						onValueChange={setInferSteps}
					>
						<SelectTrigger className={inputClass}>
							<SelectValue placeholder={DEFAULT_INFER_STEPS} />
						</SelectTrigger>
						<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
							{INFERENCE_STEP_OPTIONS.map((steps) => (
								<SelectItem
									key={steps}
									value={steps}
									className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
								>
									{steps} STEPS
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsField>

				<div className="grid grid-cols-2 gap-3">
					<SettingsField
						label="LM Temperature"
						hint="0.1-1.5 — HIGHER = MORE CREATIVE"
					>
						<Select value={lmTemp || DEFAULT_LM_TEMP} onValueChange={setLmTemp}>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder={DEFAULT_LM_TEMP} />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{LM_TEMPERATURE_OPTIONS.map((value) => (
									<SelectItem
										key={value}
										value={value}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>

					<SettingsField
						label="LM CFG Scale"
						hint="1.0-5.0 — HIGHER = FOLLOW PROMPT MORE"
					>
						<Select value={lmCfg || DEFAULT_LM_CFG} onValueChange={setLmCfg}>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder={DEFAULT_LM_CFG} />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{LM_CFG_OPTIONS.map((value) => (
									<SelectItem
										key={value}
										value={value}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>
				</div>

				<SettingsField label="Diffusion Method">
					<ToggleButtons
						options={[
							{ label: "ODE (FASTER)", value: "ode" },
							{ label: "SDE (STOCHASTIC)", value: "sde" },
						]}
						value={inferMethod}
						onChange={setInferMethod}
					/>
				</SettingsField>
			</SettingsPanel>

			<SettingsPanel title="ACE-STEP DCW CORRECTION">
				<SettingsField
					label="DCW"
					hint="ACE V0.1.7 DEFAULTS TO ON; DOUBLE MODE CORRECTS LOW AND HIGH WAVELET BANDS"
				>
					<ToggleButtons
						options={[
							{ label: "ON", value: true },
							{ label: "OFF", value: false },
						]}
						value={aceDcwEnabled}
						onChange={setAceDcwEnabled}
					/>
				</SettingsField>

				<div className="grid grid-cols-2 gap-3">
					<SettingsField label="Mode">
						<Select value={aceDcwMode} onValueChange={setAceDcwMode}>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder="DOUBLE" />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{ACE_DCW_MODES.map((mode) => (
									<SelectItem
										key={mode}
										value={mode}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{mode.toUpperCase()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>

					<SettingsField label="Wavelet">
						<Select
							value={aceDcwWavelet || ACE_DCW_DEFAULTS.wavelet}
							onValueChange={setAceDcwWavelet}
						>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder="HAAR" />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{WAVELET_OPTIONS.map((wavelet) => (
									<SelectItem
										key={wavelet}
										value={wavelet}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{wavelet.toUpperCase()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<SettingsField label="Scaler">
						<Select
							value={aceDcwScaler || String(ACE_DCW_DEFAULTS.scaler)}
							onValueChange={setAceDcwScaler}
						>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder="0.05" />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{DCW_SCALER_OPTIONS.map((value) => (
									<SelectItem
										key={value}
										value={value}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>

					<SettingsField label="High Scaler">
						<Select
							value={aceDcwHighScaler || String(ACE_DCW_DEFAULTS.highScaler)}
							onValueChange={setAceDcwHighScaler}
						>
							<SelectTrigger className={inputClass}>
								<SelectValue placeholder="0.02" />
							</SelectTrigger>
							<SelectContent className="rounded-none border-4 border-white/20 bg-gray-900 font-mono">
								{DCW_HIGH_SCALER_OPTIONS.map((value) => (
									<SelectItem
										key={value}
										value={value}
										className="font-mono text-sm font-bold uppercase text-white cursor-pointer"
									>
										{value}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</SettingsField>
				</div>
			</SettingsPanel>

			<Button
				className="w-full h-10 rounded-none border-2 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white/60 hover:bg-white/10 hover:text-white"
				onClick={() => {
					setAceThinking(false);
					setInferSteps(DEFAULT_INFER_STEPS);
					setLmTemp(DEFAULT_LM_TEMP);
					setLmCfg(DEFAULT_LM_CFG);
					setInferMethod(DEFAULT_INFER_METHOD);
					setAceQueueDepth("12");
					setAceDcwEnabled(ACE_DCW_DEFAULTS.enabled);
					setAceDcwMode(ACE_DCW_DEFAULTS.mode);
					setAceDcwScaler(String(ACE_DCW_DEFAULTS.scaler));
					setAceDcwHighScaler(String(ACE_DCW_DEFAULTS.highScaler));
					setAceDcwWavelet(ACE_DCW_DEFAULTS.wavelet);
				}}
			>
				RESET TO DEFAULTS
			</Button>
		</div>
	);
}
