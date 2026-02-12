export type TestStatus =
	| { state: "idle" }
	| { state: "testing" }
	| { state: "ok"; message: string }
	| { state: "error"; message: string };

export function TestButton({
	provider,
	status,
	onTest,
}: {
	provider: string;
	status: TestStatus;
	onTest: (provider: string) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				className="font-mono text-[10px] font-black uppercase tracking-wider text-white/40 hover:text-yellow-400 transition-colors"
				onClick={() => onTest(provider)}
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
}
