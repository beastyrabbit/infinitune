import { ACE_DCW_DEFAULTS } from "@infinitune/shared/ace-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	aceAutoDuration,
	setAceAutoDuration,
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
							EDITING ACTIVE PLAYLIST
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
					label="Auto Duration"
					hint="ON = ACE DECIDES SONG LENGTH FROM LYRICS, OFF = USE LLM-SPECIFIED DURATION"
				>
					<ToggleButtons
						options={[
							{ label: "AUTO (RECOMMENDED)", value: true },
							{ label: "FIXED", value: false },
						]}
						value={aceAutoDuration}
						onChange={setAceAutoDuration}
					/>
				</SettingsField>

				<SettingsField
					label="Inference Steps"
					hint="4-16 — HIGHER = BETTER QUALITY, SLOWER"
				>
					<Input
						className={inputClass}
						placeholder="12"
						value={inferSteps}
						onChange={(e) => {
							if (e.target.value === "" || /^\d+$/.test(e.target.value))
								setInferSteps(e.target.value);
						}}
					/>
				</SettingsField>

				<div className="grid grid-cols-2 gap-3">
					<SettingsField
						label="LM Temperature"
						hint="0.1-1.5 — HIGHER = MORE CREATIVE"
					>
						<Input
							className={inputClass}
							placeholder="0.85"
							value={lmTemp}
							onChange={(e) => {
								if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value))
									setLmTemp(e.target.value);
							}}
						/>
					</SettingsField>

					<SettingsField
						label="LM CFG Scale"
						hint="1.0-5.0 — HIGHER = FOLLOW PROMPT MORE"
					>
						<Input
							className={inputClass}
							placeholder="2.5"
							value={lmCfg}
							onChange={(e) => {
								if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value))
									setLmCfg(e.target.value);
							}}
						/>
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
								{["low", "high", "double", "pix"].map((mode) => (
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
						<Input
							className={inputClass}
							placeholder="haar"
							value={aceDcwWavelet}
							onChange={(e) => setAceDcwWavelet(e.target.value)}
						/>
					</SettingsField>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<SettingsField label="Scaler">
						<Input
							className={inputClass}
							placeholder="0.05"
							value={aceDcwScaler}
							onChange={(e) => {
								if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value))
									setAceDcwScaler(e.target.value);
							}}
						/>
					</SettingsField>

					<SettingsField label="High Scaler">
						<Input
							className={inputClass}
							placeholder="0.02"
							value={aceDcwHighScaler}
							onChange={(e) => {
								if (e.target.value === "" || /^\d*\.?\d*$/.test(e.target.value))
									setAceDcwHighScaler(e.target.value);
							}}
						/>
					</SettingsField>
				</div>
			</SettingsPanel>

			<Button
				className="w-full h-10 rounded-none border-2 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white/60 hover:bg-white/10 hover:text-white"
				onClick={() => {
					setAceThinking(false);
					setAceAutoDuration(true);
					setInferSteps("8");
					setLmTemp("0.85");
					setLmCfg("2.5");
					setInferMethod("ode");
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
