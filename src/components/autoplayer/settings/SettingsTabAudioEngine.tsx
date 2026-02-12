import { Input } from "@/components/ui/input";
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
	activePlaylist: boolean;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-bold uppercase text-white focus-visible:ring-0";

export function SettingsTabAudioEngine({
	inferSteps,
	setInferSteps,
	lmTemp,
	setLmTemp,
	lmCfg,
	setLmCfg,
	inferMethod,
	setInferMethod,
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
				{/* Inference Steps */}
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

				{/* LM Temperature + CFG Scale — side by side */}
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

				{/* Diffusion Method */}
				<SettingsField label="Diffusion Method">
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
				</SettingsField>
			</SettingsPanel>
		</div>
	);
}
