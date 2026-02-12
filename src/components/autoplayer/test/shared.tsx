import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export { LiveTimer } from "@/components/autoplayer/LiveTimer";
export { formatElapsed } from "@/lib/format-time";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface StepState {
	status: StepStatus;
	startedAt: number | null;
	completedAt: number | null;
	input: unknown;
	output: unknown;
	error: string | null;
}

export function StatusBadge({ status }: { status: StepStatus }) {
	const styles: Record<StepStatus, string> = {
		pending: "bg-white/10 text-white/40",
		running: "bg-yellow-500 text-black animate-pulse",
		done: "bg-green-600 text-white",
		error: "bg-red-600 text-white",
		skipped: "bg-white/5 text-white/20",
	};
	return (
		<span
			className={`px-2 py-0.5 text-[10px] font-black uppercase ${styles[status]}`}
		>
			{status}
		</span>
	);
}

export function CollapsibleJson({
	label,
	data,
}: {
	label: string;
	data: unknown;
}) {
	const [open, setOpen] = useState(false);
	if (data === null || data === undefined) return null;

	return (
		<div className="mt-2">
			<button
				type="button"
				className="flex items-center gap-1 text-[10px] font-black uppercase text-white/30 hover:text-white/60"
				onClick={() => setOpen(!open)}
			>
				{open ? (
					<ChevronDown className="h-3 w-3" />
				) : (
					<ChevronRight className="h-3 w-3" />
				)}
				{label}
			</button>
			{open && (
				<pre className="mt-1 text-[10px] font-mono text-white/50 bg-black border-2 border-white/10 p-2 max-h-48 overflow-auto whitespace-pre-wrap">
					{typeof data === "string" ? data : JSON.stringify(data, null, 2)}
				</pre>
			)}
		</div>
	);
}
