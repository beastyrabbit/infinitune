import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeft,
	Check,
	Copy,
	House,
	Pause,
	Play,
	RefreshCw,
	SkipForward,
	Square,
	Volume2,
	VolumeX,
	WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	clearStoredShooIdToken,
	getStoredShooIdToken,
	setStoredShooIdToken,
} from "@/integrations/api/client";
import {
	useAssignDeviceToPlaylist,
	useControlAuthSession,
	useDeviceAssignments,
	useIssueDeviceToken,
	useOwnedDevices,
	usePlaylistSessionInfo,
	usePlaylistsAll,
	useSendPlaylistCommand,
	useUnassignDeviceFromPlaylist,
} from "@/integrations/api/hooks";

export const Route = createFileRoute("/rooms")({
	component: HousePage,
});

function clampVolume(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function formatLastSeen(timestamp: number | null | undefined): string {
	if (!timestamp) return "never";
	const deltaMs = Date.now() - timestamp;
	if (deltaMs < 60_000) return "just now";
	if (deltaMs < 3_600_000) {
		return `${Math.floor(deltaMs / 60_000)}m ago`;
	}
	if (deltaMs < 86_400_000) {
		return `${Math.floor(deltaMs / 3_600_000)}h ago`;
	}
	return `${Math.floor(deltaMs / 86_400_000)}d ago`;
}

function HousePage() {
	const navigate = useNavigate();
	const [tokenInput, setTokenInput] = useState(
		() => getStoredShooIdToken() ?? "",
	);
	const [hasStoredToken, setHasStoredToken] = useState(() =>
		Boolean(getStoredShooIdToken()),
	);
	const [newDeviceName, setNewDeviceName] = useState("Living Room Speaker");
	const [issuedToken, setIssuedToken] = useState<string | null>(null);
	const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
	const [commandTarget, setCommandTarget] = useState<"playlist" | "device">(
		"playlist",
	);
	const [targetDeviceId, setTargetDeviceId] = useState<string>("");
	const [assignmentDraft, setAssignmentDraft] = useState<
		Record<string, string>
	>({});

	const authSession = useControlAuthSession();
	const playlists = usePlaylistsAll() ?? [];
	const canManageDevices = Boolean(
		authSession?.authenticated || hasStoredToken,
	);
	const devices = useOwnedDevices(canManageDevices) ?? [];
	const assignments = useDeviceAssignments(canManageDevices) ?? [];

	const sendCommand = useSendPlaylistCommand();
	const issueDeviceToken = useIssueDeviceToken();
	const assignDeviceToPlaylist = useAssignDeviceToPlaylist();
	const unassignDeviceFromPlaylist = useUnassignDeviceFromPlaylist();

	const sortedPlaylists = useMemo(
		() => [...playlists].sort((a, b) => b.createdAt - a.createdAt),
		[playlists],
	);

	useEffect(() => {
		if (selectedPlaylistId) return;
		const active = sortedPlaylists.find(
			(playlist) => playlist.status === "active",
		);
		setSelectedPlaylistId(active?.id ?? sortedPlaylists[0]?.id ?? "");
	}, [selectedPlaylistId, sortedPlaylists]);

	const selectedSession = usePlaylistSessionInfo(selectedPlaylistId || null);

	const assignmentByDeviceId = useMemo(() => {
		const map = new Map<string, string>();
		for (const assignment of assignments) {
			if (assignment.isActive) {
				map.set(assignment.deviceId, assignment.playlistId);
			}
		}
		return map;
	}, [assignments]);

	useEffect(() => {
		if (devices.length === 0) return;
		setAssignmentDraft((prev) => {
			const next = { ...prev };
			for (const device of devices) {
				if (next[device.id]) continue;
				next[device.id] = assignmentByDeviceId.get(device.id) ?? "";
			}
			return next;
		});
	}, [devices, assignmentByDeviceId]);

	const runCommand = async (
		action: "play" | "pause" | "stop" | "skip" | "setVolume" | "toggleMute",
		payload?: Record<string, unknown>,
	) => {
		if (!selectedPlaylistId) return;
		await sendCommand({
			playlistId: selectedPlaylistId,
			action,
			payload,
			targetDeviceId:
				commandTarget === "device" && targetDeviceId
					? targetDeviceId
					: undefined,
		});
	};

	const currentVolume = selectedSession?.playback.volume ?? 0.8;
	const selectedPlaylist = sortedPlaylists.find(
		(p) => p.id === selectedPlaylistId,
	);
	const commandsDisabled =
		!canManageDevices ||
		!selectedPlaylistId ||
		(commandTarget === "device" && !targetDeviceId);

	return (
		<div
			className="min-h-screen text-stone-100"
			style={{
				fontFamily:
					"'IBM Plex Mono', 'SFMono-Regular', ui-monospace, monospace",
				backgroundColor: "#070b12",
				backgroundImage:
					"radial-gradient(circle at 20% 15%, rgba(87, 123, 255, 0.22), transparent 38%), radial-gradient(circle at 82% 22%, rgba(255, 138, 76, 0.2), transparent 36%), radial-gradient(circle at 50% 78%, rgba(44, 209, 167, 0.16), transparent 38%)",
			}}
		>
			<div className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
				<header className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-sm">
					<div className="flex items-center gap-3">
						<House className="h-5 w-5 text-cyan-300" />
						<h1 className="text-2xl font-black uppercase tracking-[0.18em] sm:text-3xl">
							House Control
						</h1>
						<Badge className="rounded-none border border-cyan-400/50 bg-cyan-400/10 text-[10px] uppercase tracking-[0.16em] text-cyan-200">
							playlist sessions
						</Badge>
					</div>
					<Link
						to="/autoplayer"
						className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.16em] text-white/70 hover:text-white"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
						Back To Player
					</Link>
				</header>

				<div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
					<section className="space-y-6">
						<div className="border border-white/15 bg-black/35 p-4 backdrop-blur-sm">
							<div className="mb-3 flex items-center justify-between">
								<h2 className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">
									Auth + Session
								</h2>
								<span className="text-[11px] uppercase tracking-[0.14em] text-white/55">
									{authSession?.authenticated ? "authenticated" : "guest mode"}
								</span>
							</div>
							<p className="mb-3 text-xs text-white/60">
								Paste a Shoo ID token to unlock device management and
								owner-scoped playlist controls.
							</p>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Input
									value={tokenInput}
									onChange={(event) => setTokenInput(event.target.value)}
									placeholder="Shoo ID token"
									className="rounded-none border-white/20 bg-black/45 font-mono text-xs"
								/>
								<Button
									onClick={() => {
										const trimmed = tokenInput.trim();
										if (!trimmed) return;
										setStoredShooIdToken(trimmed);
										setHasStoredToken(true);
									}}
									className="rounded-none border border-emerald-400/50 bg-emerald-500/15 px-4 text-xs font-black uppercase tracking-[0.14em] text-emerald-200 hover:bg-emerald-500/30"
								>
									Save Token
								</Button>
								<Button
									onClick={() => {
										clearStoredShooIdToken();
										setTokenInput("");
										setHasStoredToken(false);
									}}
									variant="outline"
									className="rounded-none border-white/20 bg-white/5 px-4 text-xs font-black uppercase tracking-[0.14em] text-white/75"
								>
									Clear
								</Button>
							</div>
						</div>

						<div className="border border-white/15 bg-black/35 p-4 backdrop-blur-sm">
							<div className="mb-4 flex items-center justify-between">
								<h2 className="text-xs font-black uppercase tracking-[0.16em] text-orange-200">
									Playlist Session Controls
								</h2>
								<div className="text-[11px] uppercase tracking-[0.14em] text-white/55">
									{selectedSession?.devices.length ?? 0} connected devices
								</div>
							</div>

							<div className="grid gap-3 md:grid-cols-2">
								<div>
									<p className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-white/55">
										Session Playlist
									</p>
									<Select
										value={selectedPlaylistId || "__none"}
										onValueChange={(value) =>
											setSelectedPlaylistId(value === "__none" ? "" : value)
										}
									>
										<SelectTrigger className="h-10 rounded-none border-white/20 bg-black/45 text-xs font-bold uppercase tracking-[0.06em]">
											<SelectValue placeholder="Select playlist" />
										</SelectTrigger>
										<SelectContent className="rounded-none border-white/20 bg-[#101826] font-mono">
											<SelectItem value="__none">
												No playlist selected
											</SelectItem>
											{sortedPlaylists.map((playlist) => (
												<SelectItem key={playlist.id} value={playlist.id}>
													{playlist.name} ({playlist.status})
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div>
									<p className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-white/55">
										Command Scope
									</p>
									<Select
										value={commandTarget}
										onValueChange={(value) =>
											setCommandTarget(
												value === "device" ? "device" : "playlist",
											)
										}
									>
										<SelectTrigger className="h-10 rounded-none border-white/20 bg-black/45 text-xs font-bold uppercase tracking-[0.06em]">
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="rounded-none border-white/20 bg-[#101826] font-mono">
											<SelectItem value="playlist">Global Playlist</SelectItem>
											<SelectItem value="device">Single Device</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							{commandTarget === "device" && (
								<div className="mt-3">
									<p className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.14em] text-white/55">
										Target Device
									</p>
									<Select
										value={targetDeviceId || "__none"}
										onValueChange={(value) =>
											setTargetDeviceId(value === "__none" ? "" : value)
										}
									>
										<SelectTrigger className="h-10 rounded-none border-white/20 bg-black/45 text-xs font-bold uppercase tracking-[0.06em]">
											<SelectValue placeholder="Select device" />
										</SelectTrigger>
										<SelectContent className="rounded-none border-white/20 bg-[#101826] font-mono">
											<SelectItem value="__none">No target device</SelectItem>
											{(selectedSession?.devices ?? []).map((device) => (
												<SelectItem key={device.id} value={device.id}>
													{device.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							<div className="mt-4 flex flex-wrap gap-2">
								<Button
									onClick={() => runCommand("play")}
									disabled={commandsDisabled}
									className="rounded-none border border-emerald-300/50 bg-emerald-500/15 text-xs font-black uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-500/30"
								>
									<Play className="mr-1 h-3.5 w-3.5" />
									Start
								</Button>
								<Button
									onClick={() => runCommand("pause")}
									disabled={commandsDisabled}
									className="rounded-none border border-amber-300/50 bg-amber-500/15 text-xs font-black uppercase tracking-[0.12em] text-amber-100 hover:bg-amber-500/30"
								>
									<Pause className="mr-1 h-3.5 w-3.5" />
									Pause
								</Button>
								<Button
									onClick={() => runCommand("stop")}
									disabled={commandsDisabled}
									className="rounded-none border border-rose-300/50 bg-rose-500/15 text-xs font-black uppercase tracking-[0.12em] text-rose-100 hover:bg-rose-500/30"
								>
									<Square className="mr-1 h-3.5 w-3.5" />
									Stop
								</Button>
								<Button
									onClick={() => runCommand("skip")}
									disabled={commandsDisabled}
									className="rounded-none border border-cyan-300/50 bg-cyan-500/15 text-xs font-black uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-500/30"
								>
									<SkipForward className="mr-1 h-3.5 w-3.5" />
									Skip
								</Button>
								<Button
									onClick={() => runCommand("toggleMute")}
									disabled={commandsDisabled}
									variant="outline"
									className="rounded-none border-white/25 bg-white/5 text-xs font-black uppercase tracking-[0.12em]"
								>
									<VolumeX className="mr-1 h-3.5 w-3.5" />
									Mute
								</Button>
								<Button
									onClick={() =>
										runCommand("setVolume", {
											volume: clampVolume(currentVolume - 0.05),
										})
									}
									disabled={commandsDisabled}
									variant="outline"
									className="rounded-none border-white/25 bg-white/5 text-xs font-black uppercase tracking-[0.12em]"
								>
									VOL-
								</Button>
								<Button
									onClick={() =>
										runCommand("setVolume", {
											volume: clampVolume(currentVolume + 0.05),
										})
									}
									disabled={commandsDisabled}
									variant="outline"
									className="rounded-none border-white/25 bg-white/5 text-xs font-black uppercase tracking-[0.12em]"
								>
									VOL+
								</Button>
							</div>

							<div className="mt-4 border border-white/15 bg-black/35 px-3 py-2 text-xs text-white/70">
								<div className="mb-1 uppercase tracking-[0.13em] text-white/50">
									Now Playing
								</div>
								<div className="font-bold text-white/90">
									{selectedSession?.currentSong?.title ?? "Nothing queued"}
								</div>
								<div className="text-white/55">
									{selectedSession?.currentSong?.artistName ?? "-"}
								</div>
								<div className="mt-1 uppercase tracking-[0.1em] text-white/45">
									Playlist: {selectedPlaylist?.name ?? "-"}
								</div>
							</div>
						</div>
					</section>

					<section className="space-y-6">
						<div className="border border-white/15 bg-black/35 p-4 backdrop-blur-sm">
							<div className="mb-3 flex items-center justify-between">
								<h2 className="text-xs font-black uppercase tracking-[0.16em] text-lime-200">
									Device Tokens
								</h2>
								<WandSparkles className="h-4 w-4 text-lime-300" />
							</div>
							<p className="mb-3 text-xs text-white/60">
								Generate a token once, paste it into the daemon config, then
								assign the device to any playlist session.
							</p>
							<div className="flex gap-2">
								<Input
									value={newDeviceName}
									onChange={(event) => setNewDeviceName(event.target.value)}
									placeholder="Device name"
									className="rounded-none border-white/20 bg-black/45 text-xs"
								/>
								<Button
									onClick={async () => {
										if (!newDeviceName.trim()) return;
										const issued = await issueDeviceToken({
											name: newDeviceName.trim(),
										});
										setIssuedToken(issued.token);
									}}
									disabled={!canManageDevices || !newDeviceName.trim()}
									className="rounded-none border border-lime-300/50 bg-lime-500/15 px-3 text-xs font-black uppercase tracking-[0.14em] text-lime-100 hover:bg-lime-500/30"
								>
									Issue
								</Button>
							</div>
							{issuedToken && (
								<div className="mt-3 border border-lime-300/30 bg-lime-500/10 p-2 text-xs text-lime-100">
									<div className="mb-1 uppercase tracking-[0.12em] text-lime-200">
										New token (shown once)
									</div>
									<div className="break-all font-bold">{issuedToken}</div>
									<Button
										onClick={async () => {
											try {
												await navigator.clipboard.writeText(issuedToken);
											} catch {
												// Clipboard support is optional.
											}
										}}
										variant="outline"
										className="mt-2 h-7 rounded-none border-lime-200/40 bg-lime-500/20 text-[10px] font-black uppercase tracking-[0.12em] text-lime-50"
									>
										<Copy className="mr-1 h-3 w-3" />
										Copy
									</Button>
								</div>
							)}
						</div>

						<div className="border border-white/15 bg-black/35 p-4 backdrop-blur-sm">
							<div className="mb-3 flex items-center justify-between">
								<h2 className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-200">
									Registered Devices
								</h2>
								<span className="text-[11px] uppercase tracking-[0.14em] text-white/55">
									{devices.length} total
								</span>
							</div>
							<div className="space-y-2">
								{devices.map((device) => {
									const activePlaylistId =
										assignmentByDeviceId.get(device.id) ?? "";
									const draft = assignmentDraft[device.id] ?? activePlaylistId;
									const isAssigned = Boolean(activePlaylistId);
									return (
										<div
											key={device.id}
											className="border border-white/12 bg-black/30 p-3"
										>
											<div className="mb-2 flex items-center justify-between">
												<div>
													<div className="text-xs font-black uppercase tracking-[0.12em] text-white/90">
														{device.name}
													</div>
													<div className="text-[10px] uppercase tracking-[0.12em] text-white/50">
														last seen {formatLastSeen(device.lastSeenAt)}
													</div>
												</div>
												<Badge className="rounded-none border border-white/20 bg-white/5 text-[10px] uppercase tracking-[0.1em] text-white/70">
													{device.status}
												</Badge>
											</div>

											<Select
												value={draft || "__none"}
												onValueChange={(value) =>
													setAssignmentDraft((prev) => ({
														...prev,
														[device.id]: value === "__none" ? "" : value,
													}))
												}
											>
												<SelectTrigger className="h-9 rounded-none border-white/20 bg-black/45 text-xs font-bold uppercase tracking-[0.06em]">
													<SelectValue placeholder="Select playlist" />
												</SelectTrigger>
												<SelectContent className="rounded-none border-white/20 bg-[#101826] font-mono">
													<SelectItem value="__none">Unassigned</SelectItem>
													{sortedPlaylists.map((playlist) => (
														<SelectItem key={playlist.id} value={playlist.id}>
															{playlist.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>

											<div className="mt-2 flex flex-wrap gap-2">
												<Button
													onClick={async () => {
														if (!draft) return;
														await assignDeviceToPlaylist({
															playlistId: draft,
															deviceId: device.id,
														});
													}}
													disabled={!canManageDevices || !draft}
													className="h-7 rounded-none border border-cyan-300/50 bg-cyan-500/15 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-500/30"
												>
													<Check className="mr-1 h-3 w-3" />
													Assign
												</Button>
												<Button
													onClick={async () => {
														if (!activePlaylistId) return;
														await unassignDeviceFromPlaylist({
															playlistId: activePlaylistId,
															deviceId: device.id,
														});
													}}
													disabled={!canManageDevices || !isAssigned}
													variant="outline"
													className="h-7 rounded-none border-white/20 bg-white/5 px-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/75"
												>
													Unassign
												</Button>
											</div>
										</div>
									);
								})}
								{devices.length === 0 && (
									<div className="border border-dashed border-white/20 bg-black/25 px-3 py-6 text-center text-xs uppercase tracking-[0.14em] text-white/45">
										No devices registered yet
									</div>
								)}
							</div>
						</div>
					</section>
				</div>

				<div className="mt-6 flex items-center justify-between border border-white/12 bg-black/30 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-white/55">
					<div className="inline-flex items-center gap-2">
						<Volume2 className="h-3.5 w-3.5 text-white/45" />
						Device daemon setup:{" "}
						<code className="text-white/80">url + device token</code>
					</div>
					<Button
						onClick={() => navigate({ to: "/autoplayer" })}
						variant="outline"
						className="h-7 rounded-none border-white/20 bg-white/5 px-2 text-[10px] font-black uppercase tracking-[0.12em]"
					>
						<RefreshCw className="mr-1 h-3 w-3" />
						Return To Player
					</Button>
				</div>
			</div>
		</div>
	);
}
