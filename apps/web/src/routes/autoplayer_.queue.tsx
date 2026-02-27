import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LiveTimer } from "@/components/autoplayer/LiveTimer";
import { Badge } from "@/components/ui/badge";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import {
	type EndpointStatus,
	useWorkerInspect,
	useWorkerStatus,
	type WorkerStatus,
} from "@/hooks/useWorkerStatus";
import {
	usePlaylistByKey,
	useSongQueue,
	useSongsBatch,
} from "@/integrations/api/hooks";
import {
	getCoverColors,
	getCoverPattern,
	getInitials,
	getPatternStyle,
} from "@/lib/cover-utils";
import { formatElapsed } from "@/lib/format-time";
import { computePipelineTruth, type PipelineTruth } from "@/lib/pipeline-truth";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";
import type { Song } from "@/types";

export const Route = createFileRoute("/autoplayer_/queue")({
	component: QueuePage,
	validateSearch: validatePlaylistKeySearch,
});

// ─── Song data types ────────────────────────────────────────────────

interface SongInfo {
	title: string;
	artistName: string;
	genre: string;
	coverUrl?: string;
	status: string;
	orderIndex: number;
	promptEpoch: number;
	isInterrupt: boolean;
	playlistId: string;
}

interface QueueSnapshot {
	at: number;
	llmActive: number;
	llmPending: number;
	audioActive: number;
	audioPending: number;
	llmOldestActiveMs: number;
	llmOldestPendingMs: number;
	audioOldestActiveMs: number;
	audioOldestPendingMs: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

// ─── Mini cover art (no disc effect, just raw art) ──────────────────

function MiniCover({
	title,
	artistName,
	coverUrl,
	size = 48,
}: {
	title: string;
	artistName: string;
	coverUrl?: string;
	size?: number;
}) {
	if (coverUrl) {
		return (
			<div
				className="shrink-0 overflow-hidden border-2 border-white/20"
				style={{ width: size, height: size }}
			>
				<img
					src={coverUrl}
					alt={title}
					className="w-full h-full object-cover"
				/>
			</div>
		);
	}

	const [bg, accent1] = getCoverColors(title, artistName);
	const pattern = getCoverPattern(title);
	const patternStyle = getPatternStyle(pattern);
	const initials = getInitials(title);

	return (
		<div
			className="shrink-0 overflow-hidden border-2 border-white/20 flex items-center justify-center relative"
			style={{ width: size, height: size, backgroundColor: bg }}
		>
			<div className="absolute inset-0" style={patternStyle} />
			<div
				className="absolute inset-0 opacity-20"
				style={{
					background: `linear-gradient(135deg, ${accent1} 0%, transparent 60%)`,
				}}
			/>
			<span className="text-sm font-black text-white relative z-10 select-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
				{initials}
			</span>
		</div>
	);
}

// ─── Priority decoding ───────────────────────────────────────────────

function decodePriority(p: number): { label: string; color: string } {
	if (p >= 20000) return { label: "PERSONA", color: "text-pink-400/60" };
	if (p >= 10000) return { label: "CLOSING", color: "text-white/20" };
	if (p >= 5000) return { label: "OLD EPOCH", color: "text-orange-400/60" };
	if (p >= 100) return { label: "NORMAL", color: "text-white/40" };
	if (p === 1) return { label: "INTERRUPT", color: "text-cyan-400" };
	if (p === 0) return { label: "ONESHOT", color: "text-yellow-400" };
	return { label: "???", color: "text-white/20" };
}

function maxAgeFromItems(
	items: Array<{ startedAt?: number; waitingSince?: number }>,
	field: "startedAt" | "waitingSince",
	now: number,
) {
	let maxAgeMs = 0;
	for (const item of items) {
		const timestamp = item[field];
		if (typeof timestamp !== "number") continue;
		maxAgeMs = Math.max(maxAgeMs, Math.max(0, now - timestamp));
	}
	return maxAgeMs;
}

function formatRuntime(ms: number) {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	const totalSec = Math.floor(ms / 1000);
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min >= 60) {
		const hours = Math.floor(min / 60);
		const remMin = min % 60;
		return `${hours}h ${remMin}m`;
	}
	if (min > 0) return `${min}m ${sec}s`;
	return `${sec}s`;
}

function Sparkline({
	values,
	colorClass,
}: {
	values: number[];
	colorClass: string;
}) {
	if (values.length < 2) {
		return (
			<div className="h-12 flex items-center justify-center text-[9px] text-white/25 uppercase tracking-widest">
				NO TREND YET
			</div>
		);
	}

	const width = 220;
	const height = 44;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = Math.max(1, max - min);
	const stepX = width / Math.max(1, values.length - 1);
	const points = values
		.map((value, index) => {
			const x = Math.round(index * stepX);
			const y = Math.round(height - ((value - min) / range) * (height - 4) - 2);
			return `${x},${y}`;
		})
		.join(" ");

	return (
		<div className="h-12">
			<svg
				viewBox={`0 0 ${width} ${height}`}
				className="w-full h-full overflow-visible"
				aria-label="Queue trend"
			>
				<title>Queue trend</title>
				<polyline
					points={points}
					fill="none"
					className={`${colorClass} stroke-current`}
					strokeWidth="2.5"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
			</svg>
		</div>
	);
}

function getActorStateLabel(status: string): string {
	return status === "running" ? "RUNNING" : "STOPPED";
}

function getActorStateClass(status: string): string {
	return status === "running" ? "text-green-400" : "text-white/30";
}

function getActorStateDot(status: string): string {
	return status === "running" ? "bg-green-400" : "bg-white/30";
}

function summarizeInspectEvent(event: unknown): {
	eventType: string;
	context: string;
} {
	if (event === null || event === undefined) {
		return {
			eventType: "UNKNOWN",
			context: "No event payload",
		};
	}

	if (typeof event !== "object") {
		return {
			eventType: "RAW",
			context: String(event),
		};
	}

	const payload = event as Record<string, unknown>;
	const type =
		typeof payload.type === "string"
			? payload.type
			: typeof payload.event === "object" &&
					payload.event !== null &&
					typeof (payload.event as Record<string, unknown>).type === "string"
				? `event:${String((payload.event as Record<string, unknown>).type)}`
				: "EVENT";

	let context = "No context";
	if (typeof payload.actorRef === "string") {
		context = payload.actorRef;
	} else if (
		typeof payload.actor === "object" &&
		payload.actor &&
		typeof (payload.actor as Record<string, unknown>).id === "string"
	) {
		context = (payload.actor as Record<string, unknown>).id as string;
	}

	return { eventType: type, context };
}

function WorkerInspectPanel({
	inspect,
	error,
}: {
	inspect: {
		enabled: boolean;
		maxEvents: number;
		events: { at: number; event: unknown }[];
	} | null;
	error: string | null;
}) {
	if (error) {
		return (
			<div className="border border-red-500/40 bg-red-950/30 p-3">
				<div className="text-[10px] font-black uppercase tracking-widest text-red-400">
					INSPECTOR ERROR
				</div>
				<div className="text-[10px] text-red-300 mt-1">{error}</div>
			</div>
		);
	}

	if (!inspect) {
		return (
			<div className="border border-white/15 bg-black/40 p-3 text-[10px] text-white/40">
				Loading inspector...
			</div>
		);
	}

	if (!inspect.enabled) {
		return (
			<div className="border border-white/15 bg-black/40 p-3">
				<div className="text-[10px] font-black uppercase tracking-widest text-white/60">
					XSTATE INSPECT DISABLED
				</div>
				<div className="text-[10px] text-white/40 mt-1">
					Set XSTATE_INSPECT_ENABLED=1 to stream runtime events.
				</div>
			</div>
		);
	}

	const recentEvents = [...inspect.events].reverse().slice(0, 40);
	return (
		<div className="border-2 border-white/15 bg-black/40">
			<div className="px-4 py-2 border-b border-white/10 flex justify-between items-center">
				<div className="text-[10px] text-white/30 font-black uppercase tracking-widest">
					XSTATE INSPECTOR
				</div>
				<div className="text-[10px] text-white/40">
					{recentEvents.length}/{inspect.maxEvents}
				</div>
			</div>
			<div className="border-b border-white/10 px-4 py-2 text-[9px] text-white/40">
				Recent actor/runtime events
			</div>
			<div className="p-3">
				<div className="max-h-56 overflow-auto border border-white/10">
					{recentEvents.length === 0 ? (
						<div className="p-2 text-[9px] text-white/20 uppercase tracking-widest">
							No events yet
						</div>
					) : (
						<div className="text-[10px]">
							{recentEvents.map((row) => {
								const info = summarizeInspectEvent(row.event);
								return (
									<div
										key={`${row.at}-${info.context}`}
										className="border-b border-white/5 px-2 py-2 space-y-1"
									>
										<div className="text-white/80 font-black uppercase">
											{new Date(row.at).toLocaleTimeString()} · {info.eventType}
										</div>
										<div className="text-white/40 font-mono text-[9px]">
											{info.context}
										</div>
										<pre className="text-[8px] text-white/30 font-mono overflow-x-auto">
											{JSON.stringify(row.event)}
										</pre>
									</div>
								);
							})}
						</div>
					)}
				</div>
				<div className="text-[9px] text-white/30 mt-2 uppercase tracking-widest">
					Buffer: {inspect.maxEvents} max events
				</div>
			</div>
		</div>
	);
}

function ActorRuntimePanel({
	actorGraph,
	songMap,
}: {
	actorGraph: NonNullable<WorkerStatus["actorGraph"]>;
	songMap: Map<string, SongInfo>;
}) {
	const playlistsRunning = actorGraph.playlists.filter(
		(item) => item.status === "running",
	).length;
	const songsRunning = actorGraph.songs.filter(
		(item) => item.status === "running",
	).length;

	const sortedPlaylists = [...actorGraph.playlists].sort((a, b) =>
		a.playlistId.localeCompare(b.playlistId),
	);
	const sortedSongs = [...actorGraph.songs].sort((a, b) =>
		a.songId.localeCompare(b.songId),
	);

	return (
		<div className="border-2 border-white/15 bg-black/40">
			<div className="px-4 py-2 border-b border-white/10">
				<div className="text-[10px] text-white/30 font-bold uppercase tracking-widest">
					ACTOR RUNTIME
				</div>
			</div>
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
				<div className="p-3 space-y-2">
					<div className="text-[10px] font-black uppercase tracking-widest text-white/60">
						Playlist Actors ({actorGraph.playlists.length})
					</div>
					<div className="text-[9px] text-white/30">
						RUNNING {playlistsRunning} / STOPPED{" "}
						{actorGraph.playlists.length - playlistsRunning}
					</div>
					<div className="border border-white/10 p-2 max-h-48 overflow-auto space-y-1">
						{sortedPlaylists.length === 0 ? (
							<div className="text-[9px] text-white/20 uppercase tracking-widest">
								No playlist actors
							</div>
						) : (
							sortedPlaylists.map((item, index) => {
								const isLast = index === sortedPlaylists.length - 1;
								return (
									<div key={item.playlistId} className="text-[10px]">
										<div className="flex items-start gap-2">
											<span className="text-white/20">├─</span>
											<span
												className={`h-2 w-2 rounded-full mt-1 shrink-0 ${getActorStateDot(item.status)} ${item.status === "running" ? "animate-pulse" : ""}`}
											/>
											<div className="min-w-0 flex-1">
												<div className="font-black uppercase text-white/70 truncate">
													playlist:{item.playlistId}
												</div>
												<div
													className={`text-[9px] font-mono ${getActorStateClass(item.status)}`}
												>
													{isLast ? "└─ " : "├─ "}
													{getActorStateLabel(item.status)}
												</div>
											</div>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>

				<div className="p-3 space-y-2">
					<div className="text-[10px] font-black uppercase tracking-widest text-white/60">
						Song Actors ({actorGraph.songs.length})
					</div>
					<div className="text-[9px] text-white/30">
						RUNNING {songsRunning} / STOPPED{" "}
						{actorGraph.songs.length - songsRunning}
					</div>
					<div className="border border-white/10 p-2 max-h-48 overflow-auto space-y-1">
						{sortedSongs.length === 0 ? (
							<div className="text-[9px] text-white/20 uppercase tracking-widest">
								No song actors
							</div>
						) : (
							sortedSongs.map((item, index) => {
								const isLast = index === sortedSongs.length - 1;
								const song = songMap.get(item.songId);
								const label = song
									? `${song.title} by ${song.artistName} · ${song.playlistId}`
									: item.songId;
								return (
									<div key={item.songId} className="text-[10px]">
										<div className="flex items-start gap-2">
											<span className="text-white/20">├─</span>
											<span
												className={`h-2 w-2 rounded-full mt-1 shrink-0 ${getActorStateDot(item.status)} ${item.status === "running" ? "animate-pulse" : ""}`}
											/>
											<div className="min-w-0 flex-1">
												<div className="font-black uppercase text-white/70 truncate">
													{label}
												</div>
												<div
													className={`text-[9px] font-mono truncate ${getActorStateClass(item.status)}`}
												>
													{isLast ? "└─ " : "├─ "}
													{item.songId} • {getActorStateLabel(item.status)}
												</div>
											</div>
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Song card for active/pending items ─────────────────────────────

function SongCard({
	songInfo,
	timerStartedAt,
	variant,
	priority,
	endpoint,
	index,
}: {
	songInfo: SongInfo | null;
	timerStartedAt: number;
	variant: "active" | "pending";
	priority?: number;
	endpoint?: string;
	index: number;
}) {
	const title = songInfo?.title || "Generating...";
	const artist = songInfo?.artistName || "...";
	const genre = songInfo?.genre || "";

	const isActive = variant === "active";
	const isPersona = priority !== undefined && priority >= 20000;
	const isOldEpoch =
		priority !== undefined && priority >= 5000 && priority < 10000;
	const borderColor = isActive
		? isPersona
			? "border-pink-500/60"
			: "border-green-500/60"
		: isPersona
			? "border-pink-500/20"
			: isOldEpoch
				? "border-orange-500/20"
				: "border-white/10";
	const bgColor = isActive
		? isPersona
			? "bg-pink-950/20"
			: "bg-green-950/20"
		: isPersona
			? "bg-pink-950/10"
			: isOldEpoch
				? "bg-orange-950/10"
				: "bg-white/[0.02]";

	const decoded = priority !== undefined ? decodePriority(priority) : null;

	return (
		<div
			className={`group flex items-center gap-3 border-2 ${borderColor} ${bgColor} p-2.5 transition-colors hover:bg-white/[0.04]`}
			style={{
				animationDelay: `${index * 60}ms`,
			}}
		>
			{/* Cover thumbnail */}
			<MiniCover
				title={title}
				artistName={artist}
				coverUrl={songInfo?.coverUrl}
				size={44}
			/>

			{/* Song info */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<p
						className={`text-xs font-black uppercase truncate leading-tight ${isOldEpoch ? "text-white/30" : ""}`}
					>
						{title}
					</p>
					{isPersona && (
						<span className="shrink-0 text-[9px] font-black text-pink-400 border border-pink-400/40 px-1 leading-tight">
							PERSONA
						</span>
					)}
					{!isPersona && songInfo?.isInterrupt && (
						<span className="shrink-0 text-[9px] font-black text-cyan-400 border border-cyan-400/40 px-1 leading-tight">
							REQ
						</span>
					)}
				</div>
				<div className="flex items-center gap-2 mt-0.5">
					<p
						className={`text-[10px] uppercase truncate leading-tight ${isOldEpoch ? "text-white/20" : "text-white/40"}`}
					>
						{artist}
						{genre && (
							<>
								{" "}
								<span className="text-white/20">{"//"}</span> {genre}
							</>
						)}
					</p>
					{songInfo && (
						<span className="shrink-0 text-[9px] font-mono text-white/15 tabular-nums">
							#{String(Math.round(songInfo.orderIndex)).padStart(2, "0")}
							{" E"}
							{songInfo.promptEpoch}
						</span>
					)}
				</div>
			</div>

			{/* Priority + timer + endpoint */}
			<div className="shrink-0 text-right flex flex-col items-end gap-0.5">
				{isActive ? (
					<>
						<span
							className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase ${isPersona ? "text-pink-400" : "text-green-400"}`}
						>
							<span
								className={`h-1.5 w-1.5 rounded-full ${isPersona ? "bg-pink-400" : "bg-green-400"} animate-pulse`}
							/>
							{isPersona ? "EXTRACTING" : "PROCESSING"}
						</span>
						{endpoint && (
							<span
								className={`text-[9px] font-mono uppercase ${isPersona ? "text-pink-400/50" : "text-green-400/50"}`}
							>
								{endpoint}
							</span>
						)}
						<LiveTimer
							startedAt={timerStartedAt}
							className={`text-xs font-mono tabular-nums ${isPersona ? "text-pink-400/80" : "text-green-400/80"}`}
						/>
					</>
				) : (
					<>
						{decoded && (
							<span
								className={`text-[10px] font-bold uppercase ${decoded.color}`}
							>
								{decoded.label}
							</span>
						)}
						{endpoint && (
							<span className="text-[9px] font-mono text-white/20 uppercase">
								{endpoint}
							</span>
						)}
						{priority !== undefined && (
							<span className="text-[9px] font-mono text-white/15 tabular-nums">
								P{priority}
							</span>
						)}
						<LiveTimer
							startedAt={timerStartedAt}
							className="text-[10px] font-mono text-yellow-500/50 tabular-nums"
						/>
					</>
				)}
			</div>
		</div>
	);
}

// ─── Endpoint panel ─────────────────────────────────────────────────

function EndpointPanel({
	label,
	icon,
	accentColor,
	status,
	songMap,
}: {
	label: string;
	icon: string;
	accentColor: string;
	status: EndpointStatus;
	songMap: Map<string, SongInfo>;
}) {
	const hasActivity = status.active > 0;
	const hasErrors = status.errors > 0;

	const stateLabel = hasActivity
		? "ACTIVE"
		: hasErrors
			? "ERROR"
			: status.pending > 0
				? "QUEUED"
				: "IDLE";

	const stateColor = hasActivity
		? "text-green-400"
		: hasErrors
			? "text-red-400"
			: status.pending > 0
				? "text-yellow-500"
				: "text-white/20";

	const dotColor = hasActivity
		? "bg-green-500"
		: hasErrors
			? "bg-red-500"
			: status.pending > 0
				? "bg-yellow-500"
				: "bg-white/20";

	const isEmpty =
		status.activeItems.length === 0 && status.pendingItems.length === 0;

	return (
		<div className="border-2 border-white/15 bg-black/40">
			{/* Panel header */}
			<div
				className="flex items-center justify-between px-4 py-3 border-b-2 border-white/10"
				style={{
					background: `linear-gradient(135deg, ${accentColor}08 0%, transparent 100%)`,
				}}
			>
				<div className="flex items-center gap-3">
					<span className="text-xl">{icon}</span>
					<h3 className="text-base font-black uppercase tracking-tight">
						{label}
					</h3>
				</div>
				<div className="flex items-center gap-2">
					<div
						className={`h-2.5 w-2.5 rounded-full ${dotColor} ${hasActivity ? "animate-pulse" : ""}`}
					/>
					<span className={`text-[10px] font-bold uppercase ${stateColor}`}>
						{stateLabel}
					</span>
				</div>
			</div>

			{/* Stats strip */}
			<div className="flex items-center border-b-2 border-white/10">
				<div className="flex-1 text-center py-2 border-r border-white/5">
					<span className="text-lg font-black tabular-nums">
						{status.active}
					</span>
					<span className="text-[9px] text-white/30 uppercase ml-1.5">
						ACTIVE
					</span>
				</div>
				<div className="flex-1 text-center py-2 border-r border-white/5">
					<span className="text-lg font-black tabular-nums text-white/70">
						{status.pending}
					</span>
					<span className="text-[9px] text-white/30 uppercase ml-1.5">
						WAITING
					</span>
				</div>
				<div className="flex-1 text-center py-2">
					<span
						className={`text-lg font-black tabular-nums ${status.errors > 0 ? "text-red-400" : "text-white/30"}`}
					>
						{status.errors}
					</span>
					<span className="text-[9px] text-white/30 uppercase ml-1.5">
						ERRORS
					</span>
				</div>
			</div>

			{/* Active items */}
			{status.activeItems.length > 0 && (
				<div className="p-2.5 space-y-1.5">
					<div className="text-[9px] text-green-400/60 font-bold uppercase tracking-widest px-0.5 mb-1">
						PROCESSING NOW
					</div>
					{status.activeItems.map((item, i) => (
						<SongCard
							key={item.songId}
							songInfo={songMap.get(item.songId) ?? null}
							timerStartedAt={item.startedAt}
							variant="active"
							priority={item.priority}
							endpoint={item.endpoint}
							index={i}
						/>
					))}
				</div>
			)}

			{/* Pending items */}
			{status.pendingItems.length > 0 && (
				<div
					className={`p-2.5 space-y-1.5 ${status.activeItems.length > 0 ? "border-t border-white/5" : ""}`}
				>
					<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest px-0.5 mb-1">
						WAITING ({status.pendingItems.length})
					</div>
					{status.pendingItems.map((item, i) => (
						<SongCard
							key={item.songId}
							songInfo={songMap.get(item.songId) ?? null}
							timerStartedAt={item.waitingSince}
							variant="pending"
							priority={item.priority}
							endpoint={item.endpoint}
							index={i}
						/>
					))}
				</div>
			)}

			{/* Empty state */}
			{isEmpty && !hasErrors && (
				<div className="px-4 py-6 text-center">
					<span className="text-[10px] text-white/15 font-bold uppercase tracking-widest">
						NO ITEMS IN QUEUE
					</span>
				</div>
			)}

			{/* Error message */}
			{status.lastErrorMessage && (
				<div className="border-t-2 border-red-500/30 px-3 py-2">
					<div className="text-[10px] text-red-400/80 font-mono truncate">
						{status.lastErrorMessage}
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Worker overview strip ──────────────────────────────────────────

function WorkerOverview({ status }: { status: WorkerStatus }) {
	const totalActive =
		status.queues.llm.active +
		status.queues.image.active +
		status.queues.audio.active;
	const totalPending =
		status.queues.llm.pending +
		status.queues.image.pending +
		status.queues.audio.pending;
	const totalErrors =
		status.queues.llm.errors +
		status.queues.image.errors +
		status.queues.audio.errors;

	return (
		<div className="flex items-stretch border-2 border-white/15 bg-black/40 divide-x-2 divide-white/10">
			<div className="flex-1 px-4 py-3 text-center">
				<div className="text-2xl font-black tabular-nums">
					{status.songWorkers}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					SONG WORKERS
				</div>
			</div>
			<div className="flex-1 px-4 py-3 text-center">
				<div className="text-2xl font-black tabular-nums text-green-400">
					{totalActive}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					PROCESSING
				</div>
			</div>
			<div className="flex-1 px-4 py-3 text-center">
				<div className="text-2xl font-black tabular-nums text-white/60">
					{totalPending}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					QUEUED
				</div>
			</div>
			<div className="flex-1 px-4 py-3 text-center">
				<div
					className={`text-2xl font-black tabular-nums ${totalErrors > 0 ? "text-red-400" : "text-white/20"}`}
				>
					{totalErrors}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					ERRORS
				</div>
			</div>
			<div className="flex-1 px-4 py-3 text-center">
				<div className="text-2xl font-black tabular-nums text-white/40">
					{formatElapsed(status.uptime * 1000)}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					UPTIME
				</div>
			</div>
		</div>
	);
}

function PipelineTruthPanel({ truth }: { truth: PipelineTruth }) {
	return (
		<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border-2 border-white/15 bg-black/40 divide-x-2 divide-y-2 md:divide-y-0 divide-white/10">
			<div className="px-3 py-2.5 text-center">
				<div className="text-xl font-black tabular-nums text-cyan-400">
					{truth.lyricsInProgress}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					LYRICS TOTAL
				</div>
			</div>
			<div className="px-3 py-2.5 text-center">
				<div className="text-xl font-black tabular-nums text-green-400">
					{truth.lyricsInQueue}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					LYRICS IN LLM
				</div>
			</div>
			<div className="px-3 py-2.5 text-center">
				<div
					className={`text-xl font-black tabular-nums ${truth.lyricsPreQueue > 0 ? "text-yellow-400" : "text-white/30"}`}
				>
					{truth.lyricsPreQueue}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					LYRICS PRE-QUEUE
				</div>
			</div>
			<div className="px-3 py-2.5 text-center">
				<div className="text-xl font-black tabular-nums text-pink-400">
					{truth.personaLlmJobs}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					PERSONA LLM JOBS
				</div>
			</div>
			<div className="px-3 py-2.5 text-center">
				<div className="text-xl font-black tabular-nums text-amber-400">
					{truth.audioInProgress}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					AUDIO TOTAL
				</div>
			</div>
			<div className="px-3 py-2.5 text-center">
				<div className="text-xl font-black tabular-nums text-white/70">
					{truth.readyCount}
				</div>
				<div className="text-[9px] text-white/30 font-bold uppercase tracking-widest">
					READY BUFFER
				</div>
			</div>
		</div>
	);
}

function QueueMonitoringPanel({ history }: { history: QueueSnapshot[] }) {
	const latest = history.at(-1);
	if (!latest) return null;

	const llmLongestObserved = Math.max(
		...history.map((point) =>
			Math.max(point.llmOldestActiveMs, point.llmOldestPendingMs),
		),
	);
	const audioLongestObserved = Math.max(
		...history.map((point) =>
			Math.max(point.audioOldestActiveMs, point.audioOldestPendingMs),
		),
	);

	return (
		<div className="border-2 border-white/15 bg-black/40">
			<div className="px-4 py-2 border-b border-white/10">
				<div className="text-[10px] text-white/30 font-bold uppercase tracking-widest">
					Runtime Monitoring
				</div>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-white/10">
				<div className="p-3 space-y-2">
					<div className="flex items-center justify-between text-[10px] uppercase tracking-widest">
						<span className="font-black text-cyan-300">LLM Longest</span>
						<span className="text-white/30">
							Live Samples: {history.length}
						</span>
					</div>
					<div className="grid grid-cols-3 gap-2">
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-cyan-300 tabular-nums">
								{formatRuntime(latest.llmOldestActiveMs)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Active Now
							</div>
						</div>
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-yellow-400 tabular-nums">
								{formatRuntime(latest.llmOldestPendingMs)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Waiting Now
							</div>
						</div>
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-white/80 tabular-nums">
								{formatRuntime(llmLongestObserved)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Window Max
							</div>
						</div>
					</div>
					<div>
						<div className="text-[9px] text-white/25 uppercase tracking-widest mb-1">
							LLM Active Workers Trend
						</div>
						<Sparkline
							values={history.map((point) => point.llmActive)}
							colorClass="text-cyan-300"
						/>
					</div>
				</div>
				<div className="p-3 space-y-2">
					<div className="flex items-center justify-between text-[10px] uppercase tracking-widest">
						<span className="font-black text-amber-300">AUDIO Longest</span>
						<span className="text-white/30">
							Live Samples: {history.length}
						</span>
					</div>
					<div className="grid grid-cols-3 gap-2">
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-amber-300 tabular-nums">
								{formatRuntime(latest.audioOldestActiveMs)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Active Now
							</div>
						</div>
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-yellow-400 tabular-nums">
								{formatRuntime(latest.audioOldestPendingMs)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Waiting Now
							</div>
						</div>
						<div className="border border-white/10 p-2">
							<div className="text-lg font-black text-white/80 tabular-nums">
								{formatRuntime(audioLongestObserved)}
							</div>
							<div className="text-[9px] text-white/30 uppercase tracking-widest">
								Window Max
							</div>
						</div>
					</div>
					<div>
						<div className="text-[9px] text-white/25 uppercase tracking-widest mb-1">
							AUDIO Queue Pressure Trend
						</div>
						<Sparkline
							values={history.map(
								(point) => point.audioActive + point.audioPending,
							)}
							colorClass="text-amber-300"
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Main page ──────────────────────────────────────────────────────

function QueuePage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const playlistByKey = usePlaylistByKey(pl ?? null);
	usePlaylistHeartbeat(playlistByKey?.id ?? null);
	const playlistSongs = useSongQueue(playlistByKey?.id ?? null);
	const { status, error } = useWorkerStatus();
	const { inspect, error: inspectError } = useWorkerInspect(200);
	const [history, setHistory] = useState<QueueSnapshot[]>([]);

	// Collect all unique song IDs from the worker status
	const songIds = useMemo(() => {
		if (!status) return [];
		const ids = new Set<string>();
		for (const queue of Object.values(status.queues)) {
			for (const item of queue.activeItems) ids.add(item.songId);
			for (const item of queue.pendingItems) ids.add(item.songId);
		}
		if (status.actorGraph) {
			for (const item of status.actorGraph.songs) ids.add(item.songId);
		}
		return [...ids];
	}, [status]);

	// Fetch song data from API
	const songsData = useSongsBatch(songIds);

	// Build a lookup map
	const songMap = useMemo(() => {
		const map = new Map<string, SongInfo>();
		if (!songsData) return map;
		for (const song of songsData as Song[]) {
			map.set(song.id, {
				title: song.title || "Generating...",
				artistName: song.artistName || "...",
				genre: song.genre || "",
				coverUrl: song.coverUrl ?? undefined,
				status: song.status,
				orderIndex: song.orderIndex,
				promptEpoch: song.promptEpoch ?? 0,
				isInterrupt: !!song.isInterrupt,
				playlistId: song.playlistId,
			});
		}
		return map;
	}, [songsData]);

	const pipelineTruth = useMemo(
		() => computePipelineTruth(playlistSongs, status),
		[playlistSongs, status],
	);

	useEffect(() => {
		if (!status) return;
		const now = Date.now();
		const snapshot: QueueSnapshot = {
			at: now,
			llmActive: status.queues.llm.active,
			llmPending: status.queues.llm.pending,
			audioActive: status.queues.audio.active,
			audioPending: status.queues.audio.pending,
			llmOldestActiveMs: maxAgeFromItems(
				status.queues.llm.activeItems,
				"startedAt",
				now,
			),
			llmOldestPendingMs: maxAgeFromItems(
				status.queues.llm.pendingItems,
				"waitingSince",
				now,
			),
			audioOldestActiveMs: maxAgeFromItems(
				status.queues.audio.activeItems,
				"startedAt",
				now,
			),
			audioOldestPendingMs: maxAgeFromItems(
				status.queues.audio.pendingItems,
				"waitingSince",
				now,
			),
		};
		setHistory((prev) => [...prev.slice(-59), snapshot]);
	}, [status]);

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<button
							type="button"
							className="text-white/60 hover:text-white transition-colors"
							onClick={() =>
								navigate({ to: "/autoplayer", search: (prev) => prev })
							}
						>
							<ArrowLeft className="h-5 w-5" />
						</button>
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							QUEUE
						</h1>
						<Badge className="rounded-none border-2 border-green-500/50 bg-green-500/10 font-mono text-[10px] text-green-400 px-2 py-0.5">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse mr-1.5" />
							LIVE
						</Badge>
					</div>
					{status && (
						<div className="hidden sm:flex items-center gap-3 text-[10px] text-white/30 font-bold uppercase tracking-widest">
							<span>{status.songWorkers} WORKERS</span>
							<span className="text-white/10">|</span>
							<span>
								{status.playlists.length} PLAYLIST
								{status.playlists.length !== 1 ? "S" : ""}
							</span>
						</div>
					)}
				</div>
			</header>

			<div className="p-4 space-y-4">
				{/* Error state */}
				{error && (
					<div className="border-2 border-red-500/40 bg-red-950/30 p-4 flex items-center gap-3">
						<div className="h-3 w-3 rounded-full bg-red-500 animate-pulse shrink-0" />
						<div>
							<div className="text-xs font-black uppercase text-red-400">
								WORKER UNREACHABLE
							</div>
							<div className="text-[10px] text-red-400/60 font-mono mt-0.5">
								{error}
							</div>
						</div>
					</div>
				)}

				{/* Loading state */}
				{!status && !error && (
					<div className="flex items-center justify-center py-20 gap-3">
						<Loader2 className="h-5 w-5 animate-spin text-white/30" />
						<span className="text-xs text-white/30 font-bold uppercase tracking-widest">
							CONNECTING TO WORKER
						</span>
					</div>
				)}

				{status && (
					<>
						{/* Overview strip */}
						<WorkerOverview status={status} />
						<PipelineTruthPanel truth={pipelineTruth} />
						<QueueMonitoringPanel history={history} />
						{status.actorGraph && (
							<ActorRuntimePanel
								actorGraph={status.actorGraph}
								songMap={songMap}
							/>
						)}
						<WorkerInspectPanel inspect={inspect} error={inspectError} />

						{/* Endpoint panels */}
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
							<EndpointPanel
								label="LLM"
								icon="&#x2726;"
								accentColor="#22d3ee"
								status={status.queues.llm}
								songMap={songMap}
							/>
							<EndpointPanel
								label="IMAGE"
								icon="&#x25A0;"
								accentColor="#a855f7"
								status={status.queues.image}
								songMap={songMap}
							/>
							<EndpointPanel
								label="AUDIO"
								icon="&#x266B;"
								accentColor="#f59e0b"
								status={status.queues.audio}
								songMap={songMap}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
