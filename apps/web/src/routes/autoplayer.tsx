import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Heart,
	ListMusic,
	MessageSquareText,
	Pause,
	Play,
	Radio,
	Settings,
	SkipForward,
	ThumbsDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type RadioSnapshot,
	useRadioFeedback,
	useRadioPause,
	useRadioPlay,
	useRadioSkip,
	useRadioState,
} from "@/integrations/api/hooks";
import { API_URL, RADIO_WS_URL, resolveApiMediaUrl } from "@/lib/endpoints";
import { formatTime } from "@/lib/format-time";

export const Route = createFileRoute("/autoplayer")({
	component: AutoplayerPage,
});

function getListenerId() {
	if (typeof window === "undefined") return "server";
	const key = "infinitune-radio-listener-id";
	const existing = window.localStorage.getItem(key);
	if (existing) return existing;
	const next = crypto.randomUUID();
	window.localStorage.setItem(key, next);
	return next;
}

function coverUrl(song: RadioSnapshot["currentSong"]) {
	return (
		song?.cover?.webpUrl || song?.cover?.pngUrl || song?.cover?.jxlUrl || null
	);
}

function RadioCover({ song }: { song: RadioSnapshot["currentSong"] }) {
	const src = coverUrl(song);
	return (
		<div className="relative aspect-square overflow-hidden border border-white/15 bg-zinc-950 shadow-2xl shadow-black/40">
			{src ? (
				<img
					src={src}
					alt={song?.albumTitle ?? song?.title ?? "Album cover"}
					className="h-full w-full object-cover"
				/>
			) : (
				<div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#101820,#243b35_45%,#d7b46a_45%,#d7b46a_48%,#151515_48%)]">
					<Radio className="h-20 w-20 text-white/75" />
				</div>
			)}
			<div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/70 px-4 py-3 backdrop-blur">
				<div className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
					{song?.albumTitle ?? "Global Radio"}
				</div>
			</div>
		</div>
	);
}

function useRadioSocket(
	listenerId: string,
	onSnapshot: (snapshot: RadioSnapshot) => void,
) {
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		let disposed = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		function connect() {
			if (disposed) return;
			const ws = new WebSocket(RADIO_WS_URL);
			wsRef.current = ws;
			ws.onmessage = (event) => {
				try {
					const payload = JSON.parse(event.data) as Partial<RadioSnapshot> & {
						type?: string;
					};
					if (payload.station && payload.schedule) {
						const currentSong = payload.currentSong
							? {
									...payload.currentSong,
									audioUrl: resolveApiMediaUrl(payload.currentSong.audioUrl),
									cover: payload.currentSong.cover
										? {
												pngUrl: resolveApiMediaUrl(
													payload.currentSong.cover.pngUrl,
												),
												webpUrl: resolveApiMediaUrl(
													payload.currentSong.cover.webpUrl,
												),
												jxlUrl: resolveApiMediaUrl(
													payload.currentSong.cover.jxlUrl,
												),
											}
										: null,
								}
							: null;
						onSnapshot({
							station: payload.station,
							currentSong,
							schedule: payload.schedule.map((item) => ({
								...item,
								audioUrl: resolveApiMediaUrl(item.audioUrl),
							})),
						});
					}
				} catch {
					// Ignore non-state messages.
				}
			};
			ws.onclose = () => {
				wsRef.current = null;
				if (!disposed) reconnectTimer = setTimeout(connect, 1500);
			};
			ws.onerror = () => ws.close();
		}

		connect();
		return () => {
			disposed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			wsRef.current?.close();
		};
	}, [onSnapshot]);

	const send = useCallback(
		(payload: Record<string, unknown>) => {
			const ws = wsRef.current;
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ listenerId, ...payload }));
				return true;
			}
			return false;
		},
		[listenerId],
	);

	return send;
}

function AutoplayerPage() {
	const listenerId = useMemo(getListenerId, []);
	const initialState = useRadioState();
	const [snapshot, setSnapshot] = useState<RadioSnapshot | null>(null);
	const [joined, setJoined] = useState(false);
	const [localTime, setLocalTime] = useState(0);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const playRadio = useRadioPlay();
	const pauseRadio = useRadioPause();
	const skipRadio = useRadioSkip();
	const feedbackRadio = useRadioFeedback();

	const send = useRadioSocket(listenerId, setSnapshot);
	const state = snapshot ?? initialState ?? null;
	const currentSong = state?.currentSong ?? null;
	const durationSeconds = (currentSong?.durationMs ?? 180_000) / 1000;
	const progress =
		durationSeconds > 0
			? Math.min(100, (localTime / durationSeconds) * 100)
			: 0;
	const audioSrc = currentSong?.audioUrl
		? resolveApiMediaUrl(currentSong.audioUrl)
		: null;

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio || !audioSrc) return;
		if (audio.src !== audioSrc) audio.src = audioSrc;
		const target = (state?.station.offsetMs ?? 0) / 1000;
		if (
			Number.isFinite(target) &&
			Math.abs(audio.currentTime - target) > 1.25
		) {
			audio.currentTime = target;
		}
		if (joined && state?.station.isPlaying) {
			audio.play().catch(() => {});
		} else {
			audio.pause();
		}
	}, [audioSrc, joined, state?.station.isPlaying, state?.station.offsetMs]);

	useEffect(() => {
		const timer = setInterval(() => {
			const audio = audioRef.current;
			setLocalTime(audio?.currentTime ?? (state?.station.offsetMs ?? 0) / 1000);
			if (joined) send({ type: "heartbeat" });
		}, 1000);
		return () => clearInterval(timer);
	}, [joined, send, state?.station.offsetMs]);

	const handlePlay = useCallback(async () => {
		setJoined(true);
		if (!send({ type: "play" })) {
			setSnapshot(await playRadio({ listenerId }));
		}
	}, [listenerId, playRadio, send]);

	const handlePause = useCallback(async () => {
		setJoined(false);
		audioRef.current?.pause();
		if (!send({ type: "pause" })) {
			setSnapshot(await pauseRadio({ listenerId }));
		}
	}, [listenerId, pauseRadio, send]);

	const handleSkip = useCallback(async () => {
		if (!send({ type: "skip" })) {
			setSnapshot(await skipRadio({ listenerId }));
		}
	}, [listenerId, send, skipRadio]);

	const handleFeedback = useCallback(
		async (kind: "like" | "dislike") => {
			if (!currentSong) return;
			if (!send({ type: "feedback", songId: currentSong.id, kind })) {
				setSnapshot(await feedbackRadio({ songId: currentSong.id, kind }));
			}
		},
		[currentSong, feedbackRadio, send],
	);

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			{/* biome-ignore lint/a11y/useMediaCaption: generated music has no caption track */}
			<audio ref={audioRef} preload="auto" src={audioSrc ?? undefined} />
			<header className="border-b border-white/10 bg-black/70">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center border border-emerald-400/40 bg-emerald-400/10">
							<Radio className="h-5 w-5 text-emerald-300" />
						</div>
						<div>
							<h1 className="font-mono text-xl font-black uppercase tracking-[0.18em]">
								Infinitune Radio
							</h1>
							<p className="font-mono text-xs uppercase tracking-[0.22em] text-white/40">
								{state?.station.activeListenerCount ?? 0} active listeners
							</p>
						</div>
					</div>
					<nav className="flex flex-wrap gap-2 font-mono text-xs font-black uppercase tracking-widest">
						<Link
							to="/autoplayer/library"
							className="border border-white/15 px-3 py-2 text-white/60 hover:border-white/40 hover:text-white"
						>
							Library
						</Link>
						<Link
							to="/autoplayer/queue"
							className="border border-white/15 px-3 py-2 text-white/60 hover:border-white/40 hover:text-white"
						>
							Queue
						</Link>
						<Link
							to="/autoplayer/orchestrator"
							className="border border-white/15 px-3 py-2 text-white/60 hover:border-white/40 hover:text-white"
						>
							Phone Line
						</Link>
						<Link
							to="/autoplayer/settings"
							className="border border-white/15 px-3 py-2 text-white/60 hover:border-white/40 hover:text-white"
						>
							Settings
						</Link>
					</nav>
				</div>
			</header>

			<main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(280px,440px)_1fr]">
				<RadioCover song={currentSong} />

				<section className="min-w-0">
					<div className="border border-white/10 bg-[#171a1b] p-5">
						<div className="mb-5 flex flex-wrap items-start justify-between gap-4">
							<div className="min-w-0">
								<p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-emerald-300">
									Global synced station
								</p>
								<h2 className="mt-2 break-words text-3xl font-black uppercase leading-none tracking-normal text-white sm:text-4xl md:text-6xl">
									{currentSong?.title ?? "Waiting for signal"}
								</h2>
								<p className="mt-2 break-words font-mono text-sm uppercase tracking-[0.2em] text-white/45">
									{currentSong?.artistName ?? "No ready radio song yet"}
								</p>
							</div>
							<div className="border border-white/10 px-3 py-2 text-right font-mono">
								<div className="text-2xl font-black text-amber-300">3:00</div>
								<div className="text-[10px] uppercase tracking-[0.2em] text-white/35">
									fixed
								</div>
							</div>
						</div>

						<div className="mb-5">
							<div className="mb-2 flex justify-between font-mono text-xs text-white/45">
								<span>{formatTime(localTime)}</span>
								<span>{formatTime(durationSeconds)}</span>
							</div>
							<div className="h-2 border border-white/15 bg-black">
								<div
									className="h-full bg-amber-300"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							<Button
								onClick={joined ? handlePause : handlePlay}
								className="h-12 rounded-none bg-emerald-300 px-6 font-mono font-black uppercase text-black hover:bg-emerald-200"
							>
								{joined ? (
									<Pause className="mr-2 h-5 w-5" />
								) : (
									<Play className="mr-2 h-5 w-5" />
								)}
								{joined ? "Pause" : "Play"}
							</Button>
							<Button
								variant="outline"
								onClick={handleSkip}
								className="h-12 rounded-none border-white/20 bg-transparent px-4 font-mono font-black uppercase text-white hover:bg-white hover:text-black"
							>
								<SkipForward className="mr-2 h-5 w-5" />
								Skip
							</Button>
							<Button
								variant="outline"
								onClick={() => handleFeedback("like")}
								disabled={!currentSong}
								className="h-12 rounded-none border-white/20 bg-transparent px-4 font-mono font-black uppercase text-white hover:bg-white hover:text-black"
							>
								<Heart className="mr-2 h-5 w-5" />
								{currentSong?.likeCount ?? 0}
							</Button>
							<Button
								variant="outline"
								onClick={() => handleFeedback("dislike")}
								disabled={!currentSong}
								className="h-12 rounded-none border-white/20 bg-transparent px-4 font-mono font-black uppercase text-white hover:bg-white hover:text-black"
							>
								<ThumbsDown className="mr-2 h-5 w-5" />
								{currentSong?.dislikeCount ?? 0}
							</Button>
						</div>
					</div>

					<div className="mt-6 grid gap-3 md:grid-cols-3">
						<Link
							to="/autoplayer/orchestrator"
							className="flex items-center gap-3 border border-white/10 bg-[#171a1b] p-4 hover:border-emerald-300/50"
						>
							<MessageSquareText className="h-5 w-5 text-emerald-300" />
							<span className="font-mono text-xs font-black uppercase tracking-widest text-white/70">
								Request
							</span>
						</Link>
						<Link
							to="/autoplayer/queue"
							className="flex items-center gap-3 border border-white/10 bg-[#171a1b] p-4 hover:border-amber-300/50"
						>
							<ListMusic className="h-5 w-5 text-amber-300" />
							<span className="font-mono text-xs font-black uppercase tracking-widest text-white/70">
								Airing Plan
							</span>
						</Link>
						<Link
							to="/autoplayer/settings"
							className="flex items-center gap-3 border border-white/10 bg-[#171a1b] p-4 hover:border-sky-300/50"
						>
							<Settings className="h-5 w-5 text-sky-300" />
							<span className="font-mono text-xs font-black uppercase tracking-widest text-white/70">
								Inventory
							</span>
						</Link>
					</div>

					<section className="mt-6 border border-white/10 bg-black/30">
						<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
							Radio airing plan
						</div>
						<div className="divide-y divide-white/10">
							{state?.schedule.slice(0, 10).map((item) => (
								<div
									key={`${item.slotIndex}-${item.songId}`}
									className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3"
								>
									<div className="font-mono text-xs text-white/35">
										{String(item.slotIndex + 1).padStart(2, "0")}
									</div>
									<div className="min-w-0">
										<div className="truncate text-sm font-bold uppercase text-white">
											{item.title ?? "Untitled"}
										</div>
										<div className="truncate font-mono text-[10px] uppercase tracking-widest text-white/35">
											{item.albumTitle ?? "Radio album"} /{" "}
											{item.genre ?? "genre"} / {item.vocalStyle ?? "vocal"}
										</div>
									</div>
									{item.isRequest && (
										<span className="border border-emerald-300/40 px-2 py-1 font-mono text-[10px] font-black uppercase text-emerald-200">
											Request
										</span>
									)}
								</div>
							))}
							{!state?.schedule.length && (
								<div className="px-4 py-8 text-center font-mono text-xs font-black uppercase tracking-widest text-white/30">
									No ready radio tracks
								</div>
							)}
						</div>
					</section>
				</section>
			</main>

			<footer className="mx-auto max-w-7xl px-4 pb-6 font-mono text-[10px] uppercase tracking-[0.2em] text-white/25">
				API {API_URL}
			</footer>
		</div>
	);
}
