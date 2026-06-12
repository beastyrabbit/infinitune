import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Activity,
	ArrowLeft,
	BarChart3,
	Clock3,
	Disc3,
	ListMusic,
	Loader2,
	Radio,
} from "lucide-react";
import { useMemo } from "react";
import { useWorkerStatus } from "@/hooks/useWorkerStatus";
import {
	type RadioAlbum,
	type RadioAlbumTrack,
	type RadioChartBucket,
	useRadioLibrary,
	useRadioQueue,
} from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/queue")({
	component: QueuePage,
});

const QUEUED_STATUSES = new Set([
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"retry_pending",
]);
const AUDIO_STATUSES = new Set(["generating_audio", "saving"]);

function formatDuration(ms: number | null | undefined): string {
	if (!Number.isFinite(ms ?? Number.NaN) || !ms || ms <= 0) return "0s";
	const totalSeconds = Math.floor(ms / 1000);
	const seconds = totalSeconds % 60;
	const minutes = Math.floor(totalSeconds / 60) % 60;
	const hours = Math.floor(totalSeconds / 3600);
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function Stat({
	label,
	value,
	tone = "default",
}: {
	label: string;
	value: number | string;
	tone?: "default" | "ready" | "active" | "warn";
}) {
	const valueClass =
		tone === "ready"
			? "text-emerald-200"
			: tone === "active"
				? "text-amber-200"
				: tone === "warn"
					? "text-red-200"
					: "text-white";
	return (
		<div className="border border-white/10 bg-[#171a1b] p-4">
			<div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
				{label}
			</div>
			<div className={`mt-2 text-3xl font-black ${valueClass}`}>{value}</div>
		</div>
	);
}

function Chart({
	title,
	buckets,
	valueLabel = "count",
}: {
	title: string;
	buckets: RadioChartBucket[];
	valueLabel?: "count" | "ready" | "plays";
}) {
	const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
	return (
		<section className="border border-white/10 bg-black/30">
			<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
				{title}
			</div>
			<div className="space-y-2 p-4">
				{buckets.slice(0, 10).map((bucket) => {
					const value =
						valueLabel === "ready"
							? (bucket.readyCount ?? 0)
							: valueLabel === "plays"
								? (bucket.playCount ?? 0)
								: bucket.count;
					return (
						<div key={bucket.label}>
							<div className="mb-1 flex justify-between gap-3 font-mono text-[10px] font-bold uppercase tracking-widest text-white/55">
								<span className="truncate">{bucket.label}</span>
								<span>{value}</span>
							</div>
							<div className="h-2 bg-white/10">
								<div
									className="h-full bg-amber-300"
									style={{
										width: `${Math.max(4, (bucket.count / max) * 100)}%`,
									}}
								/>
							</div>
						</div>
					);
				})}
				{buckets.length === 0 ? (
					<div className="py-4 text-center font-mono text-xs font-black uppercase tracking-widest text-white/25">
						No data
					</div>
				) : null}
			</div>
		</section>
	);
}

function countTracks(album: RadioAlbum) {
	const ready = album.tracks.filter((track) => track.status === "ready").length;
	const queued = album.tracks.filter((track) =>
		QUEUED_STATUSES.has(track.status),
	).length;
	const audio = album.tracks.filter((track) =>
		AUDIO_STATUSES.has(track.status),
	).length;
	const error = album.tracks.filter((track) => track.status === "error").length;
	const played = album.tracks.filter(
		(track) => track.status === "played",
	).length;
	const missing = Math.max(0, 12 - album.tracks.length);
	return { ready, queued, audio, error, played, missing };
}

function albumElapsed(album: RadioAlbum, now: number) {
	if (album.completedAt) return album.completedAt - album.createdAt;
	return now - album.createdAt;
}

function trackSort(a: RadioAlbumTrack, b: RadioAlbumTrack) {
	return a.albumTrackNumber - b.albumTrackNumber;
}

function QueuePage() {
	const queue = useRadioQueue();
	const library = useRadioLibrary();
	const { status: workerStatus } = useWorkerStatus();
	const now = Date.now();

	const albums = library?.albums ?? [];
	const activeAudioBySong = useMemo(
		() =>
			new Map(
				(workerStatus?.queues.audio.activeItems ?? []).map((item) => [
					item.songId,
					item,
				]),
			),
		[workerStatus],
	);
	const pendingAudioBySong = useMemo(
		() =>
			new Map(
				(workerStatus?.queues.audio.pendingItems ?? []).map((item) => [
					item.songId,
					item,
				]),
			),
		[workerStatus],
	);
	const aceQueueTracks = useMemo(
		() =>
			albums
				.flatMap((album) =>
					album.tracks.map((track) => ({
						album,
						track,
						active: activeAudioBySong.get(track.id),
						pending: pendingAudioBySong.get(track.id),
					})),
				)
				.filter(
					(row) =>
						row.active ||
						row.pending ||
						row.track.status === "submitting_to_ace" ||
						row.track.status === "generating_audio" ||
						row.track.status === "saving",
				)
				.sort((a, b) => {
					const aPriority = a.active?.priority ?? a.pending?.priority ?? 99999;
					const bPriority = b.active?.priority ?? b.pending?.priority ?? 99999;
					return aPriority - bPriority || trackSort(a.track, b.track);
				}),
		[albums, activeAudioBySong, pendingAudioBySong],
	);
	const generatingAlbums = albums
		.filter((album) => album.status === "generating")
		.sort((a, b) => a.createdAt - b.createdAt);
	const analytics = queue?.analytics;

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			<header className="border-b border-white/10 bg-black/70 px-4 py-4">
				<div className="mx-auto flex max-w-7xl items-center gap-4">
					<Link to="/autoplayer" className="text-white/55 hover:text-white">
						<ArrowLeft className="h-5 w-5" />
					</Link>
					<div>
						<h1 className="flex items-center gap-3 font-mono text-2xl font-black uppercase tracking-[0.18em]">
							<ListMusic className="h-6 w-6 text-amber-300" />
							Radio Operations
						</h1>
						<p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-white/35">
							Schedule v{queue?.station.scheduleVersion ?? 0}
						</p>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-7xl px-4 py-6">
				<div className="mb-6 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
					<Stat
						label="Ready albums"
						value={queue?.stats.untouchedReadyAlbums ?? 0}
						tone="ready"
					/>
					<Stat
						label="Generating albums"
						value={queue?.stats.untouchedGeneratingAlbums ?? 0}
						tone="active"
					/>
					<Stat
						label="Incomplete"
						value={queue?.stats.incompleteAlbums ?? 0}
						tone={(queue?.stats.incompleteAlbums ?? 0) > 0 ? "warn" : "default"}
					/>
					<Stat
						label="Missing tracks"
						value={queue?.stats.missingAlbumTracks ?? 0}
						tone={
							(queue?.stats.missingAlbumTracks ?? 0) > 0 ? "warn" : "default"
						}
					/>
					<Stat
						label="ACE pending"
						value={workerStatus?.queues.audio.pending ?? 0}
					/>
					<Stat
						label="ACE active"
						value={workerStatus?.queues.audio.active ?? 0}
						tone="active"
					/>
					<Stat
						label="Last album"
						value={formatDuration(analytics?.albumTiming.lastCompletedMs)}
					/>
					<Stat
						label="Avg album"
						value={formatDuration(analytics?.albumTiming.avgCompletedMs)}
					/>
				</div>

				<div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_420px]">
					<div className="space-y-6">
						<section className="border border-white/10 bg-black/30">
							<div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
								<Activity className="h-4 w-4 text-amber-300" />
								ACE album queue
							</div>
							<div className="divide-y divide-white/10">
								{generatingAlbums.map((album) => {
									const counts = countTracks(album);
									const runningTracks = album.tracks
										.filter(
											(track) =>
												activeAudioBySong.has(track.id) ||
												AUDIO_STATUSES.has(track.status),
										)
										.sort(trackSort);
									const pendingTracks = album.tracks
										.filter(
											(track) =>
												pendingAudioBySong.has(track.id) ||
												QUEUED_STATUSES.has(track.status),
										)
										.sort(trackSort);
									return (
										<div key={album.id} className="p-4">
											<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
												<div className="min-w-0">
													<div className="flex items-center gap-2">
														<Loader2 className="h-4 w-4 animate-spin text-amber-300" />
														<h2 className="truncate text-sm font-black uppercase text-white">
															{album.title}
														</h2>
													</div>
													<p className="mt-1 truncate font-mono text-[10px] font-bold uppercase tracking-widest text-white/35">
														{album.bandName} / {album.generationKind} /{" "}
														{album.status}
													</p>
													<p className="mt-3 text-sm leading-relaxed text-white/60">
														{album.theme}
													</p>
												</div>
												<div className="grid grid-cols-2 gap-2 font-mono text-[10px] font-black uppercase tracking-widest">
													<div className="border border-white/10 p-2 text-white/55">
														Elapsed
														<div className="mt-1 text-lg text-white">
															{formatDuration(albumElapsed(album, now))}
														</div>
													</div>
													<div className="border border-white/10 p-2 text-white/55">
														Ready
														<div className="mt-1 text-lg text-emerald-200">
															{counts.ready}/12
														</div>
													</div>
													<div className="border border-white/10 p-2 text-white/55">
														Queued
														<div className="mt-1 text-lg text-white">
															{counts.queued}
														</div>
													</div>
													<div className="border border-white/10 p-2 text-white/55">
														Missing
														<div
															className={`mt-1 text-lg ${
																counts.missing > 0
																	? "text-red-200"
																	: "text-white"
															}`}
														>
															{counts.missing}
														</div>
													</div>
													<div className="border border-white/10 p-2 text-white/55">
														Audio
														<div className="mt-1 text-lg text-amber-200">
															{counts.audio}
														</div>
													</div>
												</div>
											</div>

											<div className="mt-4 grid gap-3 lg:grid-cols-2">
												<div className="border border-white/10 bg-black/20 p-3">
													<div className="mb-2 font-mono text-[10px] font-black uppercase tracking-widest text-amber-200">
														Running ACE tracks
													</div>
													{runningTracks.slice(0, 6).map((track) => {
														const runtime = activeAudioBySong.has(track.id)
															? now -
																(activeAudioBySong.get(track.id)?.startedAt ??
																	now)
															: now -
																(track.aceSubmittedAt ??
																	track.generationStartedAt ??
																	track.createdAt);
														return (
															<div
																key={track.id}
																className="flex justify-between gap-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55"
															>
																<span className="truncate">
																	{String(track.albumTrackNumber).padStart(
																		2,
																		"0",
																	)}{" "}
																	{track.title}
																</span>
																<span className="text-amber-200">
																	{formatDuration(runtime)}
																</span>
															</div>
														);
													})}
													{runningTracks.length === 0 ? (
														<div className="py-2 font-mono text-[10px] uppercase tracking-widest text-white/25">
															No running ACE tracks
														</div>
													) : null}
												</div>

												<div className="border border-white/10 bg-black/20 p-3">
													<div className="mb-2 font-mono text-[10px] font-black uppercase tracking-widest text-white/40">
														Next queued tracks
													</div>
													{pendingTracks.slice(0, 6).map((track) => {
														const pending = pendingAudioBySong.get(track.id);
														const waitMs = pending
															? now - pending.waitingSince
															: now -
																(track.generationStartedAt ?? track.createdAt);
														return (
															<div
																key={track.id}
																className="flex justify-between gap-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white/55"
															>
																<span className="truncate">
																	{String(track.albumTrackNumber).padStart(
																		2,
																		"0",
																	)}{" "}
																	{track.status}
																</span>
																<span>{formatDuration(waitMs)}</span>
															</div>
														);
													})}
													{pendingTracks.length === 0 ? (
														<div className="py-2 font-mono text-[10px] uppercase tracking-widest text-white/25">
															No queued tracks
														</div>
													) : null}
												</div>
											</div>
										</div>
									);
								})}
								{generatingAlbums.length === 0 ? (
									<div className="p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/25">
										No active album jobs
									</div>
								) : null}
							</div>
						</section>

						<section className="border border-white/10 bg-black/30">
							<div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
								<Radio className="h-4 w-4 text-sky-300" />
								Radio mixer airing plan
							</div>
							<div className="divide-y divide-white/10">
								{queue?.schedule.map((item) => (
									<div
										key={`${item.slotIndex}-${item.songId}`}
										className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 px-4 py-4"
									>
										<div className="font-mono text-sm font-black text-sky-300">
											{String(item.slotIndex + 1).padStart(2, "0")}
										</div>
										<div className="min-w-0">
											<div className="truncate text-sm font-black uppercase text-white">
												{item.title ?? "Untitled"}
											</div>
											<div className="truncate font-mono text-[10px] uppercase tracking-widest text-white/35">
												{item.albumTitle ?? "Album"} / {item.genre ?? "genre"} /{" "}
												{item.reason}
											</div>
										</div>
										{item.isRequest ? (
											<span className="border border-emerald-300/40 px-2 py-1 font-mono text-[10px] font-black uppercase text-emerald-200">
												Request
											</span>
										) : (
											<Clock3 className="h-4 w-4 text-white/25" />
										)}
									</div>
								))}
								{!queue?.schedule.length ? (
									<div className="p-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
										No scheduled tracks
									</div>
								) : null}
							</div>
						</section>
					</div>

					<aside className="space-y-6">
						<section className="border border-white/10 bg-black/30">
							<div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
								<Disc3 className="h-4 w-4 text-amber-300" />
								ACE track queue
							</div>
							<div className="divide-y divide-white/10">
								{aceQueueTracks
									.slice(0, 24)
									.map(({ album, track, active, pending }) => {
										const queueMs = active
											? now - active.startedAt
											: pending
												? now - pending.waitingSince
												: now -
													(track.aceSubmittedAt ??
														track.generationStartedAt ??
														track.createdAt);
										return (
											<div key={track.id} className="p-3">
												<div className="flex justify-between gap-3 font-mono text-[10px] font-black uppercase tracking-widest">
													<span className="truncate text-white">
														{album.title}
													</span>
													<span
														className={
															active ? "text-amber-200" : "text-white/40"
														}
													>
														{active
															? "active"
															: pending
																? "pending"
																: track.status}
													</span>
												</div>
												<div className="mt-1 flex justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-white/45">
													<span className="truncate">
														{album.bandName} / #{track.albumTrackNumber} /{" "}
														{track.title}
													</span>
													<span>{formatDuration(queueMs)}</span>
												</div>
											</div>
										);
									})}
								{aceQueueTracks.length === 0 ? (
									<div className="p-6 text-center font-mono text-xs font-black uppercase tracking-widest text-white/25">
										No ACE queue items
									</div>
								) : null}
							</div>
						</section>

						<section className="grid grid-cols-2 gap-3">
							<Stat
								label="Album done"
								value={analytics?.albumTiming.completedAlbums ?? 0}
								tone="ready"
							/>
							<Stat
								label="Oldest active"
								value={formatDuration(analytics?.albumTiming.oldestActiveMs)}
								tone="active"
							/>
							<Stat
								label="Likes"
								value={analytics?.feedbackTotals.likes ?? 0}
								tone="ready"
							/>
							<Stat
								label="Skips"
								value={analytics?.feedbackTotals.skips ?? 0}
								tone="warn"
							/>
						</section>

						<Chart
							title="Generated genre spread"
							buckets={analytics?.generatedGenreSpread ?? []}
						/>
						<Chart
							title="Ready genre spread"
							buckets={analytics?.readyGenreSpread ?? []}
						/>
						<Chart
							title="Vocal spread"
							buckets={analytics?.vocalSpread ?? []}
						/>
						<Chart
							title="Song status spread"
							buckets={analytics?.statusSpread ?? []}
						/>

						<section className="border border-white/10 bg-black/30">
							<div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
								<BarChart3 className="h-4 w-4 text-emerald-300" />
								Request readiness
							</div>
							<div className="divide-y divide-white/10">
								{queue?.requests.slice(0, 10).map((request) => (
									<div key={request.id} className="p-4">
										<div className="flex justify-between gap-2 font-mono text-[10px] font-black uppercase tracking-widest">
											<span className="text-emerald-300">{request.kind}</span>
											<span className="text-white/35">{request.status}</span>
										</div>
										<p className="mt-2 text-sm text-white/70">
											{request.prompt}
										</p>
									</div>
								))}
								{!queue?.requests.length ? (
									<div className="p-6 text-center font-mono text-xs font-black uppercase tracking-widest text-white/25">
										No requests
									</div>
								) : null}
							</div>
						</section>
					</aside>
				</div>
			</main>
		</div>
	);
}
