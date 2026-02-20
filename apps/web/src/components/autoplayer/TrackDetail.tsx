import { Loader2, Palette, ThumbsDown } from "lucide-react";
import { useState } from "react";
import ClockIcon from "@/components/ui/clock-icon";
import FileDescriptionIcon from "@/components/ui/file-description-icon";
import LikeIcon from "@/components/ui/like-icon";
import RefreshIcon from "@/components/ui/refresh-icon";
import TrashIcon from "@/components/ui/trash-icon";
import VinylIcon from "@/components/ui/vinyl-icon";
import XIcon from "@/components/ui/x-icon";
import { useDeleteSong, useRevertSong } from "@/integrations/api/hooks";
import { formatElapsed, formatTime, isGenerating } from "@/lib/format-time";
import { STATUS_LABELS } from "@/lib/song-status";
import type { Song } from "@/types";
import { CoverArt } from "./CoverArt";
import { LiveTimer } from "./LiveTimer";

interface TrackDetailProps {
	song: Song;
	onClose: () => void;
	onDeleted?: () => void;
}

function toUniqueStringEntries(
	values: string[],
): { key: string; value: string }[] {
	const seen = new Map<string, number>();
	return values.map((value) => {
		const count = (seen.get(value) ?? 0) + 1;
		seen.set(value, count);
		return { key: `${value}-${count}`, value };
	});
}

export function TrackDetail({ song, onClose, onDeleted }: TrackDetailProps) {
	const deleteSong = useDeleteSong();
	const revertStatuses = useRevertSong();
	const [confirmDelete, setConfirmDelete] = useState(false);

	const generating = isGenerating(song.status);

	const ACTIVE_PROCESSING = [
		"generating_metadata",
		"submitting_to_ace",
		"generating_audio",
		"saving",
	];
	const isActivelyProcessing = ACTIVE_PROCESSING.includes(song.status);
	const isStuck =
		isActivelyProcessing &&
		song.generationStartedAt &&
		Date.now() - song.generationStartedAt > 2 * 60 * 1000;

	const handleDelete = async () => {
		await deleteSong({ id: song.id });
		onDeleted?.();
		onClose();
	};

	const handleReset = async () => {
		await revertStatuses({ id: song.id });
	};

	const totalGenTime =
		song.generationStartedAt && song.generationCompletedAt
			? song.generationCompletedAt - song.generationStartedAt
			: null;
	const instrumentEntries = toUniqueStringEntries(song.instruments ?? []);
	const themeEntries = toUniqueStringEntries(song.themes ?? []);
	const tagEntries = toUniqueStringEntries(song.tags ?? []);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
			<div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto border-4 border-white/20 bg-gray-950">
				{/* Header */}
				<div className="sticky top-0 z-10 border-b-4 border-white/20 bg-black px-4 py-3 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<VinylIcon size={16} className="text-red-500" />
						<span className="text-sm font-black uppercase tracking-widest">
							TRACK {String(Math.round(song.orderIndex)).padStart(2, "0")} —
							DETAILS
						</span>
					</div>
					<button
						type="button"
						className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
						onClick={onClose}
					>
						<XIcon size={20} />
					</button>
				</div>

				<div className="p-6 space-y-6">
					{/* Top: Cover + Basic Info */}
					<div className="flex gap-6">
						<div className="w-48 shrink-0">
							<CoverArt
								title={song.title || "Generating..."}
								artistName={song.artistName || "..."}
								coverUrl={song.coverUrl}
								size="md"
							/>
						</div>
						<div className="flex-1 space-y-3">
							<div>
								<h2 className="text-2xl font-black uppercase">
									{song.title || "Generating..."}
								</h2>
								<p className="text-sm font-bold uppercase text-white/50">
									{song.artistName || "..."}
								</p>
								{song.description && (
									<p className="mt-1 text-xs font-bold text-white/40 italic normal-case">
										{song.description}
									</p>
								)}
							</div>

							<div className="flex flex-wrap gap-2">
								<span className="border-2 border-white/20 px-2 py-1 text-xs font-black uppercase">
									{song.genre || "..."}
								</span>
								<span className="border-2 border-white/20 px-2 py-1 text-xs font-black uppercase text-white/60">
									{song.subGenre || "..."}
								</span>
								{song.isInterrupt && (
									<span className="border-2 border-yellow-500 px-2 py-1 text-xs font-black uppercase text-yellow-500">
										INTERRUPT
									</span>
								)}
							</div>

							{/* Status */}
							<div className="flex items-center gap-2">
								{generating && (
									<Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
								)}
								<span
									className={`text-sm font-black uppercase ${
										song.status === "error"
											? "text-red-500"
											: song.status === "retry_pending"
												? "text-orange-400"
												: generating
													? "text-yellow-500"
													: song.status === "ready"
														? "text-green-500"
														: "text-white/60"
									}`}
								>
									{STATUS_LABELS[song.status] || song.status.toUpperCase()}
								</span>
							</div>

							{song.errorMessage && (
								<p className="text-xs font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-3 py-2">
									{song.errorMessage}
								</p>
							)}

							{song.retryCount != null && song.retryCount > 0 && (
								<span className="text-xs font-black uppercase text-orange-400">
									RETRY {song.retryCount}/3
								</span>
							)}

							{/* Actions for stuck/error songs — only when actively processing too long */}
							{(isStuck || song.status === "error") && (
								<div className="flex items-center gap-2">
									{isStuck && (
										<button
											type="button"
											className="flex items-center gap-1 border-2 border-yellow-500/40 px-3 py-1.5 text-xs font-black uppercase text-yellow-500 hover:bg-yellow-500 hover:text-black transition-colors"
											onClick={handleReset}
										>
											<RefreshIcon size={12} />
											RESET
										</button>
									)}
									<button
										type="button"
										className={`flex items-center gap-1 border-2 px-3 py-1.5 text-xs font-black uppercase transition-colors ${
											confirmDelete
												? "border-red-500 bg-red-500 text-black animate-pulse"
												: "border-red-500/40 text-red-500 hover:bg-red-500 hover:text-black"
										}`}
										onClick={() => {
											if (confirmDelete) {
												handleDelete();
											} else {
												setConfirmDelete(true);
												setTimeout(() => setConfirmDelete(false), 2000);
											}
										}}
									>
										<TrashIcon size={12} />
										{confirmDelete ? "CONFIRM REMOVE" : "REMOVE"}
									</button>
								</div>
							)}

							{/* Generation Time */}
							<div className="flex items-center gap-2 text-xs font-bold uppercase text-white/40">
								<ClockIcon size={12} />
								{generating && song.generationStartedAt ? (
									<span className="text-yellow-500">
										RUNNING: <LiveTimer startedAt={song.generationStartedAt} />
									</span>
								) : totalGenTime ? (
									<span>GENERATED IN {formatElapsed(totalGenTime)}</span>
								) : (
									<span>--</span>
								)}
							</div>

							{/* Rating + Listens + Play Duration */}
							<div className="flex items-center gap-4">
								{song.userRating && (
									<div className="flex items-center gap-1 text-xs font-bold uppercase">
										{song.userRating === "up" ? (
											<>
												<LikeIcon size={12} className="text-green-400" />
												<span className="text-green-400">LIKED</span>
											</>
										) : (
											<>
												<ThumbsDown className="h-3 w-3 text-red-400" />
												<span className="text-red-400">DISLIKED</span>
											</>
										)}
									</div>
								)}
								{(song.listenCount ?? 0) > 0 && (
									<span className="text-xs font-bold uppercase text-white/40">
										{song.listenCount}{" "}
										{song.listenCount === 1 ? "LISTEN" : "LISTENS"}
									</span>
								)}
								{song.playDurationMs != null && song.playDurationMs > 0 && (
									<span className="text-xs font-bold uppercase text-white/40">
										TOTAL: {formatElapsed(song.playDurationMs)}
									</span>
								)}
							</div>
						</div>
					</div>

					{/* Music Properties */}
					<div className="border-4 border-white/10 bg-black">
						<div className="border-b-2 border-white/10 px-4 py-2">
							<span className="text-xs font-black uppercase tracking-widest text-white/40">
								<VinylIcon size={12} className="inline mr-2" />
								MUSIC PROPERTIES
							</span>
						</div>
						<div className="grid grid-cols-2 sm:grid-cols-4 divide-x-2 divide-white/10">
							<div className="p-3 text-center">
								<p className="text-[10px] font-bold uppercase text-white/30">
									BPM
								</p>
								<p className="text-lg font-black">{song.bpm ?? "--"}</p>
							</div>
							<div className="p-3 text-center">
								<p className="text-[10px] font-bold uppercase text-white/30">
									KEY
								</p>
								<p className="text-lg font-black uppercase">
									{song.keyScale ?? "--"}
								</p>
							</div>
							<div className="p-3 text-center">
								<p className="text-[10px] font-bold uppercase text-white/30">
									TIME SIG
								</p>
								<p className="text-lg font-black">
									{song.timeSignature ?? "--"}
								</p>
							</div>
							<div className="p-3 text-center">
								<p className="text-[10px] font-bold uppercase text-white/30">
									DURATION
								</p>
								<p className="text-lg font-black">
									{song.audioDuration ? formatTime(song.audioDuration) : "--"}
								</p>
							</div>
						</div>
					</div>

					{/* Tags & Metadata */}
					{(song.mood || song.energy || song.era || song.language) && (
						<div className="border-4 border-white/10 bg-black">
							<div className="border-b-2 border-white/10 px-4 py-2">
								<span className="text-xs font-black uppercase tracking-widest text-white/40">
									METADATA
								</span>
							</div>
							<div className="p-4 space-y-3">
								<div className="flex flex-wrap gap-2">
									{song.mood && (
										<span className="border-2 border-purple-500/40 px-2 py-1 text-xs font-black uppercase text-purple-400">
											{song.mood}
										</span>
									)}
									{song.energy && (
										<span className="border-2 border-cyan-500/40 px-2 py-1 text-xs font-black uppercase text-cyan-400">
											{song.energy} ENERGY
										</span>
									)}
									{song.era && (
										<span className="border-2 border-amber-500/40 px-2 py-1 text-xs font-black uppercase text-amber-400">
											{song.era}
										</span>
									)}
									{song.language && (
										<span className="border-2 border-white/20 px-2 py-1 text-xs font-black uppercase text-white/50">
											{song.language}
										</span>
									)}
								</div>
								{instrumentEntries.length > 0 && (
									<div>
										<p className="text-[10px] font-bold uppercase text-white/30 mb-1">
											INSTRUMENTS
										</p>
										<div className="flex flex-wrap gap-1">
											{instrumentEntries.map((entry) => (
												<span
													key={entry.key}
													className="border border-white/10 px-2 py-0.5 text-xs font-bold uppercase text-white/50"
												>
													{entry.value}
												</span>
											))}
										</div>
									</div>
								)}
								{themeEntries.length > 0 && (
									<div>
										<p className="text-[10px] font-bold uppercase text-white/30 mb-1">
											THEMES
										</p>
										<div className="flex flex-wrap gap-1">
											{themeEntries.map((entry) => (
												<span
													key={entry.key}
													className="border border-pink-500/30 px-2 py-0.5 text-xs font-bold uppercase text-pink-400/70"
												>
													{entry.value}
												</span>
											))}
										</div>
									</div>
								)}
								{tagEntries.length > 0 && (
									<div>
										<p className="text-[10px] font-bold uppercase text-white/30 mb-1">
											TAGS
										</p>
										<div className="flex flex-wrap gap-1">
											{tagEntries.map((entry) => (
												<span
													key={entry.key}
													className="border border-green-500/30 px-2 py-0.5 text-xs font-bold uppercase text-green-400/70"
												>
													{entry.value}
												</span>
											))}
										</div>
									</div>
								)}
							</div>
						</div>
					)}

					{/* Caption */}
					<div className="border-4 border-white/10 bg-black">
						<div className="border-b-2 border-white/10 px-4 py-2">
							<span className="text-xs font-black uppercase tracking-widest text-white/40">
								AUDIO CAPTION (ACE-STEP INPUT)
							</span>
						</div>
						<p className="px-4 py-3 text-sm font-bold uppercase text-white/70">
							{song.caption || "Pending..."}
						</p>
					</div>

					{/* Cover Prompt */}
					{song.coverPrompt && (
						<div className="border-4 border-white/10 bg-black">
							<div className="border-b-2 border-white/10 px-4 py-2">
								<span className="text-xs font-black uppercase tracking-widest text-white/40">
									<Palette className="h-3 w-3 inline mr-2" />
									COVER ART PROMPT
								</span>
							</div>
							<p className="px-4 py-3 text-sm font-bold uppercase text-white/70">
								{song.coverPrompt}
							</p>
						</div>
					)}

					{/* Interrupt Prompt */}
					{song.interruptPrompt && (
						<div className="border-4 border-yellow-500/30 bg-black">
							<div className="border-b-2 border-yellow-500/30 px-4 py-2">
								<span className="text-xs font-black uppercase tracking-widest text-yellow-500/60">
									INTERRUPT REQUEST
								</span>
							</div>
							<p className="px-4 py-3 text-sm font-bold uppercase text-yellow-500/70">
								{song.interruptPrompt}
							</p>
						</div>
					)}

					{/* Lyrics */}
					<div className="border-4 border-white/10 bg-black">
						<div className="border-b-2 border-white/10 px-4 py-2">
							<span className="text-xs font-black uppercase tracking-widest text-white/40">
								<FileDescriptionIcon size={12} className="inline mr-2" />
								LYRICS
							</span>
						</div>
						<pre className="px-4 py-3 text-xs font-bold text-white/60 whitespace-pre-wrap max-h-64 overflow-y-auto">
							{song.lyrics || "Pending..."}
						</pre>
					</div>

					{/* Technical IDs */}
					<div className="border-4 border-white/10 bg-black">
						<div className="border-b-2 border-white/10 px-4 py-2">
							<span className="text-xs font-black uppercase tracking-widest text-white/40">
								TECHNICAL
							</span>
						</div>
						<div className="px-4 py-3 space-y-1 text-[10px] font-bold uppercase text-white/20 font-mono">
							{song.llmProvider && (
								<p>
									LLM: {song.llmProvider.toUpperCase()} /{" "}
									{(song.llmModel || "unknown").toUpperCase()}
								</p>
							)}
							<p>SONG ID: {song.id}</p>
							{song.aceTaskId && <p>ACE TASK: {song.aceTaskId}</p>}
							{song.storagePath && <p>NFS PATH: {song.storagePath}</p>}
							{song.audioUrl && <p>AUDIO URL: {song.audioUrl}</p>}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
