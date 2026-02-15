import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { SongStatus } from "@infinitune/shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@/types";
import { SortableSongCard } from "./SortableSongCard";

interface QueueGridProps {
	songs: Song[];
	currentSongId: string | null;
	playlistEpoch: number;
	transitionComplete: boolean;
	onSelectSong: (songId: string) => void;
	onOpenDetail: (songId: string) => void;
	onRate: (songId: string, rating: "up" | "down") => void;
	onReorder?: (songId: string, newOrderIndex: number) => void;
}

interface EpochGroup {
	epoch: number;
	songs: Song[];
}

export function QueueGrid({
	songs,
	currentSongId,
	playlistEpoch,
	transitionComplete,
	onSelectSong,
	onOpenDetail,
	onRate,
	onReorder,
}: QueueGridProps) {
	// Optimistic reorder: temporarily override song order until Convex pushes the real update
	const [optimisticOrder, setOptimisticOrder] = useState<Map<
		string,
		number
	> | null>(null);
	const prevSongsRef = useRef(songs);

	// Clear optimistic state when songs prop changes (Convex pushed the update)
	useEffect(() => {
		if (songs !== prevSongsRef.current) {
			prevSongsRef.current = songs;
			setOptimisticOrder(null);
		}
	}, [songs]);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 5 },
		}),
		useSensor(KeyboardSensor),
	);

	// Sort: current-epoch songs first, then older epochs; within same epoch by orderIndex
	const sorted = useMemo(() => {
		const getOrder = (s: Song) => optimisticOrder?.get(s._id) ?? s.orderIndex;
		return [...songs].sort((a, b) => {
			const aEpoch = a.promptEpoch ?? 0;
			const bEpoch = b.promptEpoch ?? 0;
			if (aEpoch !== bEpoch) return bEpoch - aEpoch;
			return getOrder(a) - getOrder(b);
		});
	}, [songs, optimisticOrder]);

	// Group songs by epoch (preserving sorted order: highest epoch first)
	const epochGroups = useMemo(() => {
		const groups: EpochGroup[] = [];
		let currentGroup: EpochGroup | null = null;
		for (const song of sorted) {
			const epoch = song.promptEpoch ?? 0;
			if (!currentGroup || currentGroup.epoch !== epoch) {
				currentGroup = { epoch, songs: [] };
				groups.push(currentGroup);
			}
			currentGroup.songs.push(song);
		}
		return groups;
	}, [sorted]);

	const activeStatuses: SongStatus[] = [
		"pending",
		"generating_metadata",
		"metadata_ready",
		"submitting_to_ace",
		"generating_audio",
		"saving",
	];
	const generating = sorted.filter((s) =>
		activeStatuses.includes(s.status),
	).length;
	const retryPending = sorted.filter(
		(s) => s.status === "retry_pending",
	).length;

	const readySongs = sorted.filter(
		(s) => s.status === "ready" || s.status === "played",
	);
	const newDirReady = readySongs.filter(
		(s) => (s.promptEpoch ?? 0) === playlistEpoch,
	).length;
	const fillerReady = readySongs.filter(
		(s) => (s.promptEpoch ?? 0) !== playlistEpoch,
	).length;
	const hasInterruptPending = sorted.some(
		(s) => s.isInterrupt && activeStatuses.includes(s.status),
	);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		if (!over || active.id === over.id || !onReorder) return;

		const activeId = active.id as string;
		const overId = over.id as string;

		// Find which epoch group contains the active song
		const group = epochGroups.find((g) =>
			g.songs.some((s) => s._id === activeId),
		);
		if (!group) return;

		// Only allow reordering within the same epoch
		if (!group.songs.some((s) => s._id === overId)) return;

		const oldIndex = group.songs.findIndex((s) => s._id === activeId);
		const newIndex = group.songs.findIndex((s) => s._id === overId);
		if (oldIndex === -1 || newIndex === -1) return;

		// Compute midpoint orderIndex between new neighbors
		const reordered = [...group.songs];
		const [moved] = reordered.splice(oldIndex, 1);
		reordered.splice(newIndex, 0, moved);

		let newOrderIndex: number;
		if (newIndex === 0) {
			newOrderIndex = reordered[1]
				? reordered[1].orderIndex - 1
				: moved.orderIndex;
		} else if (newIndex === reordered.length - 1) {
			newOrderIndex = reordered[newIndex - 1].orderIndex + 1;
		} else {
			const before = reordered[newIndex - 1].orderIndex;
			const after = reordered[newIndex + 1].orderIndex;
			newOrderIndex = (before + after) / 2;
		}

		// Apply optimistic reorder immediately so there's no snap-back
		const orderMap = new Map<string, number>();
		for (let i = 0; i < reordered.length; i++) {
			orderMap.set(reordered[i]._id, i);
		}
		setOptimisticOrder(orderMap);

		onReorder(activeId, newOrderIndex);
	}

	return (
		<div className="border-b-4 border-white/20">
			<div className="bg-black px-4 py-2 flex items-center justify-between border-b-4 border-white/20">
				<span className="text-sm font-black uppercase tracking-widest">
					QUEUE [{sorted.length} TRACKS]
				</span>
				<div className="flex gap-4 text-xs uppercase tracking-wider text-white/30">
					{hasInterruptPending && (
						<span className="text-cyan-400">1 REQUEST PENDING</span>
					)}
					{!transitionComplete && playlistEpoch > 0 ? (
						<>
							<span>{newDirReady} NEW DIR</span>
							<span>{fillerReady} FILLER</span>
						</>
					) : (
						<span>{newDirReady + fillerReady} READY</span>
					)}
					<span className="text-yellow-500">{generating} GENERATING</span>
					{retryPending > 0 && (
						<span className="text-orange-400">{retryPending} RETRY</span>
					)}
				</div>
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				{epochGroups.map((group, groupIdx) => (
					<div key={group.epoch}>
						{/* Epoch divider between groups */}
						{groupIdx > 0 && playlistEpoch > 0 && (
							<div className="col-span-full border-t-4 border-cyan-500/30 flex items-center justify-center py-1.5 bg-black/50">
								<span className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/60">
									{"──── >>> STEER ──── EPOCH "}
									{group.epoch}
									{" ────"}
								</span>
							</div>
						)}
						<SortableContext
							items={group.songs.map((s) => s._id)}
							strategy={rectSortingStrategy}
						>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
								{group.songs.map((song) => {
									const songEpoch = song.promptEpoch ?? 0;
									const isCurrent = song._id === currentSongId;
									const isOldEpoch =
										!transitionComplete &&
										playlistEpoch > 0 &&
										songEpoch < playlistEpoch &&
										!isCurrent;
									return (
										<SortableSongCard
											key={song._id}
											song={song}
											isCurrent={isCurrent}
											isOldEpoch={isOldEpoch}
											onSelectSong={onSelectSong}
											onOpenDetail={onOpenDetail}
											onRate={onRate}
										/>
									);
								})}
							</div>
						</SortableContext>
					</div>
				))}
			</DndContext>
		</div>
	);
}
