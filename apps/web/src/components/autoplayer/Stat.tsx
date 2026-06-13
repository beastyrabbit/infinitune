export type StatTone = "default" | "ready" | "active" | "warn";

const TONE_CLASS: Record<StatTone, string> = {
	ready: "text-emerald-200",
	active: "text-amber-200",
	warn: "text-red-200",
	default: "text-white",
};

const TONE_RAIL: Record<StatTone, string> = {
	ready: "bg-emerald-300/60",
	active: "bg-amber-300/60",
	warn: "bg-red-400/60",
	default: "bg-white/15",
};

/** Console-style metric tile shared by the settings and radio-ops pages. */
export function Stat({
	label,
	value,
	tone = "default",
}: {
	label: string;
	value: number | string;
	tone?: StatTone;
}) {
	return (
		<div className="relative overflow-hidden border border-white/10 bg-[#171a1b] p-4">
			<div className={`absolute inset-y-0 left-0 w-0.5 ${TONE_RAIL[tone]}`} />
			<div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
				{label}
			</div>
			<div
				className={`mt-2 font-mono text-3xl font-black tabular-nums ${TONE_CLASS[tone]}`}
			>
				{value}
			</div>
		</div>
	);
}
