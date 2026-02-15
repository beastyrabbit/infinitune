import type { RoomInfo } from "@infinitune/shared/protocol";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	Headphones,
	Monitor,
	Plus,
	Radio,
	Sliders,
	Trash2,
	Volume2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePlaylistsAll } from "@/integrations/api/hooks";

const ROOM_SERVER_URL =
	typeof window !== "undefined"
		? `http://${window.location.hostname}:5175`
		: "http://localhost:5175";

export const Route = createFileRoute("/rooms")({
	component: RoomsPage,
});

function RoomsPage() {
	const navigate = useNavigate();
	const [rooms, setRooms] = useState<RoomInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [serverDown, setServerDown] = useState(false);
	const [creating, setCreating] = useState(false);
	const [newRoomName, setNewRoomName] = useState("");
	const [selectedPlaylistKey, setSelectedPlaylistKey] = useState("");
	const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(
		null,
	);
	const [deviceNameInput, setDeviceNameInput] = useState(() => {
		if (typeof window !== "undefined") {
			return localStorage.getItem("infinitune-device-name") ?? "";
		}
		return "";
	});
	const formId = useId();

	// Persist device name to localStorage
	useEffect(() => {
		if (deviceNameInput.trim()) {
			localStorage.setItem("infinitune-device-name", deviceNameInput.trim());
		}
	}, [deviceNameInput]);

	const rawPlaylists = usePlaylistsAll() ?? [];
	const playlists = [...rawPlaylists].sort((a, b) => b.createdAt - a.createdAt);

	const fetchRooms = useCallback(async () => {
		try {
			const res = await fetch(`${ROOM_SERVER_URL}/api/v1/rooms`);
			if (res.ok) {
				const data = await res.json();
				setRooms(data);
				setServerDown(false);
			}
		} catch {
			setRooms([]);
			setServerDown(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchRooms();
		const interval = setInterval(fetchRooms, 5000);
		return () => clearInterval(interval);
	}, [fetchRooms]);

	const handleCreate = async () => {
		if (!newRoomName.trim() || !selectedPlaylistKey) return;
		const id = `${newRoomName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 24)}-${Date.now().toString(36).slice(-4)}`;

		try {
			await fetch(`${ROOM_SERVER_URL}/api/v1/rooms`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					name: newRoomName.trim(),
					playlistKey: selectedPlaylistKey,
				}),
			});
			setNewRoomName("");
			setSelectedPlaylistKey("");
			setCreating(false);
			fetchRooms();
		} catch (err) {
			console.error("Failed to create room:", err);
		}
	};

	const handleDeleteRoom = async (roomId: string) => {
		try {
			await fetch(`${ROOM_SERVER_URL}/api/v1/rooms/${roomId}`, {
				method: "DELETE",
			});
			setConfirmDeleteRoom(null);
			fetchRooms();
		} catch (err) {
			console.error("Failed to delete room:", err);
		}
	};

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER — matches autoplayer */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-4">
						<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
							INFINITUNE
						</h1>
						<Badge className="rounded-none border-2 border-white/40 bg-transparent font-mono text-xs text-white/60">
							ROOMS
						</Badge>
					</div>
					<div className="flex items-center gap-4">
						<span className="hidden sm:inline text-xs uppercase tracking-widest text-white/30">
							{serverDown ? (
								<span className="text-red-500 animate-pulse">
									SERVER OFFLINE
								</span>
							) : (
								<>
									ACTIVE:{rooms.length} | DEVICES:
									{rooms.reduce((sum, r) => sum + r.deviceCount, 0)}
								</>
							)}
						</span>
						<Link
							to="/autoplayer"
							className="font-mono text-sm font-bold uppercase text-white/60 hover:text-green-500 flex items-center gap-1"
						>
							<ArrowLeft className="h-3.5 w-3.5" />
							[PLAYER]
						</Link>
					</div>
				</div>
			</header>

			{/* CONTENT */}
			<div className="max-w-3xl mx-auto px-4 py-8">
				{/* Device name input */}
				<div className="border-2 border-white/10 bg-black px-4 py-3 mb-6">
					<label
						htmlFor={`${formId}-dn`}
						className="text-[10px] font-black uppercase tracking-widest text-white/40 block mb-1.5"
					>
						YOUR DEVICE NAME
					</label>
					<input
						id={`${formId}-dn`}
						type="text"
						value={deviceNameInput}
						onChange={(e) => setDeviceNameInput(e.target.value)}
						placeholder="e.g. LIVING ROOM SPEAKER"
						className="w-full bg-white/5 border-2 border-white/15 px-3 py-2 text-sm font-mono font-bold uppercase placeholder:text-white/20 focus:outline-none focus:border-red-500 transition-colors"
					/>
				</div>

				{/* Server status warning */}
				{serverDown && !loading && (
					<div className="border-2 border-red-500/40 bg-red-500/5 px-4 py-3 mb-6 flex items-center gap-3">
						<div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
						<span className="text-xs uppercase tracking-wider text-red-400 font-bold">
							Room server unreachable — run{" "}
							<code className="text-red-300 bg-red-500/10 px-1">
								pnpm room-server
							</code>
						</span>
					</div>
				)}

				{/* Room list */}
				{loading ? (
					<div className="border-2 border-dashed border-white/10 p-12 text-center">
						<div className="inline-block h-3 w-3 bg-white/30 animate-pulse" />
						<p className="text-white/30 text-xs uppercase tracking-widest mt-3">
							Connecting to room server...
						</p>
					</div>
				) : rooms.length === 0 && !serverDown ? (
					<div className="border-2 border-dashed border-white/10 p-12 text-center">
						<Radio className="h-8 w-8 text-white/10 mx-auto mb-3" />
						<p className="text-white/30 text-xs uppercase tracking-widest mb-1">
							No active rooms
						</p>
						<p className="text-white/20 text-xs">
							Create a room to start multi-device playback
						</p>
					</div>
				) : (
					<div className="space-y-3 mb-8">
						{rooms.map((room) => (
							<div
								key={room.id}
								className="border-2 border-white/10 bg-black hover:border-white/20 transition-colors group"
							>
								{/* Room header */}
								<div className="px-4 py-3 border-b border-white/5">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-3 min-w-0">
											<div className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
											<h3 className="font-black uppercase text-lg tracking-tight truncate">
												{room.name}
											</h3>
										</div>
										<div className="flex items-center gap-3 text-xs text-white/40 flex-shrink-0">
											<span className="flex items-center gap-1">
												<Monitor size={10} />
												{room.deviceCount}
											</span>
											{confirmDeleteRoom === room.id ? (
												<div className="flex items-center gap-1">
													<button
														type="button"
														className="px-2 py-0.5 text-[10px] font-black uppercase bg-red-500 text-white hover:bg-red-400 transition-colors"
														onClick={() => handleDeleteRoom(room.id)}
													>
														DELETE
													</button>
													<button
														type="button"
														className="px-2 py-0.5 text-[10px] font-black uppercase text-white/40 hover:text-white/60 transition-colors"
														onClick={() => setConfirmDeleteRoom(null)}
													>
														CANCEL
													</button>
												</div>
											) : (
												<button
													type="button"
													className="text-white/15 hover:text-red-500 transition-colors"
													onClick={() => setConfirmDeleteRoom(room.id)}
													title="Delete room"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</button>
											)}
										</div>
									</div>
									{room.currentSong?.title && (
										<div className="mt-1.5 flex items-center gap-2">
											<span className="text-red-400 text-xs font-bold uppercase truncate">
												♪ {room.currentSong.title}
											</span>
											{room.currentSong.artistName && (
												<span className="text-white/30 text-xs truncate">
													— {room.currentSong.artistName}
												</span>
											)}
										</div>
									)}
								</div>

								{/* Room actions */}
								<div className="px-4 py-2.5 space-y-2">
									{/* Full GUI row */}
									<div className="flex items-center gap-2">
										<span className="text-[10px] font-black uppercase tracking-widest text-white/25 w-10 flex-shrink-0">
											FULL
										</span>
										<Button
											variant="outline"
											onClick={() =>
												navigate({
													to: "/autoplayer",
													search: {
														room: room.id,
														role: "controller",
														pl: room.playlistKey,
														name: room.name,
														dn: deviceNameInput.trim() || undefined,
													},
												})
											}
											className="h-8 rounded-none border-2 border-white/20 bg-white/5 text-xs font-bold uppercase text-white/70 hover:bg-white hover:text-black hover:border-white gap-1.5"
										>
											<Sliders className="h-3 w-3" />
											Controller
										</Button>
										<Button
											variant="outline"
											onClick={() =>
												navigate({
													to: "/autoplayer",
													search: {
														room: room.id,
														role: "player",
														pl: room.playlistKey,
														name: room.name,
														dn: deviceNameInput.trim() || undefined,
													},
												})
											}
											className="h-8 rounded-none border-2 border-red-500/30 bg-red-500/5 text-xs font-bold uppercase text-red-400 hover:bg-red-500 hover:text-white hover:border-red-500 gap-1.5"
										>
											<Volume2 className="h-3 w-3" />
											Player
										</Button>
									</div>
									{/* Mini row */}
									<div className="flex items-center gap-2">
										<span className="text-[10px] font-black uppercase tracking-widest text-white/25 w-10 flex-shrink-0">
											MINI
										</span>
										<Button
											variant="outline"
											onClick={() =>
												navigate({
													to: "/autoplayer/mini",
													search: {
														room: room.id,
														role: "controller",
														pl: room.playlistKey,
														name: room.name,
														dn: deviceNameInput.trim() || undefined,
													},
												})
											}
											className="h-7 rounded-none border border-white/15 bg-white/5 text-[10px] font-bold uppercase text-white/50 hover:bg-white/10 hover:text-white/70 gap-1"
										>
											<Sliders className="h-2.5 w-2.5" />
											Controller
										</Button>
										<Button
											variant="outline"
											onClick={() =>
												navigate({
													to: "/autoplayer/mini",
													search: {
														room: room.id,
														role: "player",
														pl: room.playlistKey,
														name: room.name,
														dn: deviceNameInput.trim() || undefined,
													},
												})
											}
											className="h-7 rounded-none border border-red-500/20 bg-red-500/5 text-[10px] font-bold uppercase text-red-400/60 hover:bg-red-500/10 hover:text-red-400 gap-1"
										>
											<Volume2 className="h-2.5 w-2.5" />
											Player
										</Button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}

				{/* Create room */}
				{creating ? (
					<div className="border-2 border-white/20 bg-black">
						<div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between">
							<h3 className="text-xs font-black uppercase tracking-widest text-white/60">
								New Room
							</h3>
							<button
								type="button"
								onClick={() => setCreating(false)}
								className="text-white/30 hover:text-white"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</div>
						<div className="p-4 space-y-3">
							<div>
								<label
									htmlFor={`${formId}-name`}
									className="text-xs uppercase tracking-widest text-white/40 font-bold block mb-1.5"
								>
									Room Name
								</label>
								<input
									id={`${formId}-name`}
									type="text"
									value={newRoomName}
									onChange={(e) => setNewRoomName(e.target.value)}
									placeholder="e.g. Living Room"
									className="w-full bg-white/5 border-2 border-white/15 px-3 py-2 text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-red-500 transition-colors"
									onKeyDown={(e) => {
										if (e.key === "Enter") handleCreate();
									}}
								/>
							</div>
							<div>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: radix select handles focus */}
								<label className="text-xs uppercase tracking-widest text-white/40 font-bold block mb-1.5">
									Playlist
								</label>
								<Select
									value={selectedPlaylistKey}
									onValueChange={setSelectedPlaylistKey}
								>
									<SelectTrigger className="w-full h-10 rounded-none border-2 border-white/15 bg-white/5 font-mono text-sm font-bold uppercase text-white hover:border-white/30 focus:border-red-500 focus:ring-0">
										<SelectValue placeholder="SELECT A PLAYLIST..." />
									</SelectTrigger>
									<SelectContent className="rounded-none border-2 border-white/20 bg-gray-950 font-mono max-h-60">
										{playlists.map((p) => (
											<SelectItem
												key={p.id}
												value={p.playlistKey ?? p.id}
												className="font-mono text-xs font-bold uppercase text-white/80 focus:bg-white/10 focus:text-white rounded-none cursor-pointer"
											>
												<span
													className={
														p.status === "active"
															? "text-green-500"
															: "text-white/30"
													}
												>
													{p.status === "active" ? "●" : "○"}
												</span>{" "}
												{p.name} — {p.prompt.slice(0, 40)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex gap-2 pt-1">
								<Button
									variant="outline"
									onClick={handleCreate}
									disabled={!newRoomName.trim() || !selectedPlaylistKey}
									className="h-9 rounded-none border-2 border-red-500 bg-red-500/10 text-xs font-bold uppercase text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-30 gap-1.5"
								>
									<Headphones className="h-3 w-3" />
									Create Room
								</Button>
								<Button
									variant="outline"
									onClick={() => setCreating(false)}
									className="h-9 rounded-none border-2 border-white/20 bg-white/5 text-xs font-bold uppercase text-white/50 hover:bg-white hover:text-black"
								>
									Cancel
								</Button>
							</div>
						</div>
					</div>
				) : (
					<Button
						variant="outline"
						onClick={() => setCreating(true)}
						className="h-11 rounded-none border-2 border-dashed border-white/15 bg-transparent text-xs font-bold uppercase text-white/40 hover:bg-white/5 hover:border-white/30 hover:text-white/60 w-full gap-2"
					>
						<Plus className="h-4 w-4" />
						Create Room
					</Button>
				)}
			</div>
		</div>
	);
}
