import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type EndpointStatus, useWorkerStatus } from "@/hooks/useWorkerStatus";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";

export const Route = createFileRoute("/autoplayer_/queue")({
	component: QueuePage,
	validateSearch: validatePlaylistKeySearch,
});

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

function EndpointIndicator({
	label,
	status,
}: {
	label: string;
	status: EndpointStatus;
}) {
	let dotColor = "bg-white/30"; // idle/grey
	if (status.active > 0) dotColor = "bg-green-500"; // actively processing
	if (status.errors > 0) dotColor = "bg-red-500"; // has errors

	return (
		<div className="border-2 border-white/20 p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-lg font-black uppercase tracking-tight">{label}</h3>
				<div className="flex items-center gap-2">
					<div
						className={`h-3 w-3 rounded-full ${dotColor} ${status.active > 0 ? "animate-pulse" : ""}`}
					/>
					<span className="text-xs text-white/50 uppercase">
						{status.active > 0
							? "ACTIVE"
							: status.errors > 0
								? "ERROR"
								: "IDLE"}
					</span>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-2 mb-3">
				<div className="text-center">
					<div className="text-2xl font-black">{status.pending}</div>
					<div className="text-[10px] text-white/40 uppercase">Pending</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-black text-green-400">
						{status.active}
					</div>
					<div className="text-[10px] text-white/40 uppercase">Active</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-black text-red-400">
						{status.errors}
					</div>
					<div className="text-[10px] text-white/40 uppercase">Errors</div>
				</div>
			</div>

			{/* Active items */}
			{status.activeItems.length > 0 && (
				<div className="border-t border-white/10 pt-2 mb-2">
					<div className="text-[10px] text-white/40 uppercase mb-1">
						Processing
					</div>
					{status.activeItems.map((item) => (
						<div
							key={item.songId}
							className="flex items-center justify-between text-xs py-0.5"
						>
							<span className="text-white/70 truncate max-w-[200px]">
								{item.songId}
							</span>
							<LiveTimer
								startedAt={item.startedAt}
								className="text-green-400 font-mono"
							/>
						</div>
					))}
				</div>
			)}

			{/* Pending items */}
			{status.pendingItems.length > 0 && (
				<div className="border-t border-white/10 pt-2">
					<div className="text-[10px] text-white/40 uppercase mb-1">
						Waiting
					</div>
					{status.pendingItems.slice(0, 5).map((item) => (
						<div
							key={item.songId}
							className="flex items-center justify-between text-xs py-0.5"
						>
							<span className="text-white/50 truncate max-w-[160px]">
								{item.songId}
							</span>
							<span className="text-white/30 font-mono">P{item.priority}</span>
							<LiveTimer
								startedAt={item.waitingSince}
								className="text-yellow-400/60 font-mono"
							/>
						</div>
					))}
					{status.pendingItems.length > 5 && (
						<div className="text-[10px] text-white/30 mt-1">
							+{status.pendingItems.length - 5} more
						</div>
					)}
				</div>
			)}

			{/* Last error */}
			{status.lastErrorMessage && (
				<div className="border-t border-red-500/30 pt-2 mt-2">
					<div className="text-[10px] text-red-400 truncate">
						{status.lastErrorMessage}
					</div>
				</div>
			)}
		</div>
	);
}

function LiveTimer({
	startedAt,
	className,
}: {
	startedAt: number;
	className?: string;
}) {
	// We use a trick: re-render via the parent's 2s poll, so the timer
	// updates at the same cadence as the status data.
	const elapsed = Date.now() - startedAt;
	return <span className={className}>{formatMs(elapsed)}</span>;
}

function QueuePage() {
	const navigate = useNavigate();
	const { status, error } = useWorkerStatus();

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<button
							type="button"
							className="text-white/60 hover:text-white"
							onClick={() =>
								navigate({ to: "/autoplayer", search: (prev) => prev })
							}
						>
							<ArrowLeft className="h-5 w-5" />
						</button>
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							QUEUE STATUS
						</h1>
						<Badge className="rounded-none border-2 border-white/40 bg-transparent font-mono text-xs text-white/60">
							LIVE
						</Badge>
					</div>
					{status && (
						<div className="text-xs text-white/40 uppercase">
							{status.songWorkers} workers | uptime {formatMs(status.uptime)}
						</div>
					)}
				</div>
			</header>

			<div className="p-4">
				{error && (
					<div className="border-2 border-red-500/50 bg-red-500/10 p-3 mb-4 text-sm text-red-400">
						Worker API unreachable: {error}
					</div>
				)}

				{!status && !error && (
					<div className="text-white/40 text-center py-8">
						Connecting to worker...
					</div>
				)}

				{status && (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<EndpointIndicator label="LLM" status={status.queues.llm} />
						<EndpointIndicator label="IMAGE" status={status.queues.image} />
						<EndpointIndicator label="AUDIO" status={status.queues.audio} />
					</div>
				)}
			</div>
		</div>
	);
}
