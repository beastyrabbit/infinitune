import { useEffect, useRef, useState } from "react";
import { useRoomConnection } from "@/hooks/useRoomConnection";
import { useRoomController } from "@/hooks/useRoomController";
import { useRoomPlayer } from "@/hooks/useRoomPlayer";
import type { DeviceRole, SongData } from "../../../room-server/protocol";
import { CompactBar } from "./CompactBar";
import { MediumPlayer } from "./MediumPlayer";

type LayoutMode = "compact" | "medium" | "expanded";

interface MiniPlayerProps {
	roomId: string;
	role: DeviceRole;
	roomName?: string;
	playlistKey?: string;
	deviceName?: string;
}

export function MiniPlayer({
	roomId,
	role,
	roomName = roomId,
	playlistKey,
	deviceName,
}: MiniPlayerProps) {
	const connection = useRoomConnection(
		roomId,
		deviceName || `mini-${role}`,
		role,
		playlistKey,
		roomName,
	);
	const controller = useRoomController(connection);
	const [layoutMode, setLayoutMode] = useState<LayoutMode>("medium");
	const containerRef = useRef<HTMLDivElement>(null);

	// Player audio (only active when role === "player")
	useRoomPlayer(role === "player" ? connection : null);

	// Observe container height for responsive layout
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const height = entry.contentRect.height;
				if (height < 150) {
					setLayoutMode("compact");
				} else if (height < 500) {
					setLayoutMode("medium");
				} else {
					setLayoutMode("expanded");
				}
			}
		});

		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	const { playback, currentSong, queue, devices, connected } = connection;

	return (
		<div ref={containerRef} className="h-full w-full bg-black text-white">
			{layoutMode === "compact" ? (
				<CompactBar
					song={currentSong}
					playback={playback}
					onToggle={controller.toggle}
					onSkip={controller.skip}
				/>
			) : layoutMode === "medium" ? (
				<MediumPlayer
					song={currentSong}
					playback={playback}
					devices={devices}
					roomName={roomName}
					connected={connected}
					onToggle={controller.toggle}
					onSkip={controller.skip}
					onSeek={controller.seek}
					onSetVolume={controller.setVolume}
					onToggleMute={controller.toggleMute}
					onRate={controller.rate}
				/>
			) : (
				/* Expanded: medium player + song queue */
				<div className="flex flex-col h-full">
					<div className="flex-1 min-h-0">
						<MediumPlayer
							song={currentSong}
							playback={playback}
							devices={devices}
							roomName={roomName}
							connected={connected}
							onToggle={controller.toggle}
							onSkip={controller.skip}
							onSeek={controller.seek}
							onSetVolume={controller.setVolume}
							onToggleMute={controller.toggleMute}
							onRate={controller.rate}
						/>
					</div>
					<div className="flex-shrink-0 border-t border-white/10 overflow-y-auto max-h-[40%]">
						<div className="px-4 py-2">
							<h3 className="text-xs font-black uppercase tracking-widest text-white/40 mb-2">
								Queue ({queue.filter((s) => s.status === "ready").length} ready)
							</h3>
							<div className="space-y-1">
								{queue
									.filter((s) => s.status === "ready" || s.status === "played")
									.sort((a, b) => a.orderIndex - b.orderIndex)
									.map((song) => (
										<QueueItem
											key={song._id}
											song={song}
											isPlaying={song._id === playback.currentSongId}
											onClick={() => controller.selectSong(song._id)}
										/>
									))}
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function QueueItem({
	song,
	isPlaying,
	onClick,
}: {
	song: SongData;
	isPlaying: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-white/5 transition-colors ${
				isPlaying ? "bg-red-500/10 border-l-2 border-red-500" : ""
			}`}
		>
			<span
				className={`text-xs font-bold truncate flex-1 ${
					isPlaying ? "text-red-400" : "text-white/70"
				}`}
			>
				{song.title ?? "Untitled"}
			</span>
			<span className="text-[10px] text-white/30 flex-shrink-0">
				{song.artistName ?? "Unknown"}
			</span>
		</button>
	);
}
