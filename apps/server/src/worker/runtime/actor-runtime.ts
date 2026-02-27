import { createActor, fromCallback } from "xstate";
import { logger } from "../../logger";
import { getWorkerInspectObserver } from "./inspection";
import type {
	QueueSnapshot,
	WorkerActorRuntimeSnapshot,
	WorkerRuntimeEvent,
} from "./types";

export interface WorkerRuntimeHandlers {
	handleSongCreated(data: {
		songId: string;
		playlistId: string;
		status: string;
	}): Promise<void>;
	handleSongStatusChanged(data: {
		songId: string;
		playlistId: string;
		from: string;
		to: string;
	}): Promise<void>;
	handlePlaylistCreated(data: { playlistId: string }): Promise<void>;
	handlePlaylistSteered(data: {
		playlistId: string;
		newEpoch: number;
	}): Promise<void>;
	handlePlaylistHeartbeat(data: { playlistId: string }): Promise<void>;
	handlePlaylistUpdated(data: { playlistId: string }): Promise<void>;
	handlePlaylistDeleted(data: { playlistId: string }): Promise<void>;
	handlePlaylistStatusChanged(data: {
		playlistId: string;
		from: string;
		to: string;
	}): Promise<void>;
	handleSettingsChanged(data: { key: string }): Promise<void>;
	reconcileAceState(): Promise<void>;
	startupSweep(): Promise<void>;
	tickAudioPolls(): Promise<void>;
	staleSongCleanup(): Promise<void>;
	logWorkerDiagnostics(reason: "startup" | "interval"): Promise<void>;
}

type InternalTickEvent =
	| { type: "supervisor.tick_audio" }
	| { type: "supervisor.tick_stale" }
	| { type: "supervisor.tick_diagnostics" };

type InternalRuntimeEvent = WorkerRuntimeEvent | InternalTickEvent;

export interface WorkerRuntimeHandle {
	start(): Promise<void>;
	stop(): void;
	send(event: WorkerRuntimeEvent): void;
	getSnapshot(): WorkerActorRuntimeSnapshot;
}

export interface CreateWorkerRuntimeOptions {
	handlers: WorkerRuntimeHandlers;
	enableDiagnostics?: boolean;
	diagnosticsIntervalMs?: number;
	audioPollIntervalMs?: number;
	staleCleanupIntervalMs?: number;
	getQueueSnapshot?: () => {
		llm: QueueSnapshot;
		image: QueueSnapshot;
		audio: QueueSnapshot;
	};
}

function emptyQueueSnapshot(): {
	llm: QueueSnapshot;
	image: QueueSnapshot;
	audio: QueueSnapshot;
} {
	return {
		llm: { pending: 0, active: 0, errors: 0 },
		image: { pending: 0, active: 0, errors: 0 },
		audio: { pending: 0, active: 0, errors: 0 },
	};
}

export function createWorkerRuntime(
	options: CreateWorkerRuntimeOptions,
): WorkerRuntimeHandle {
	const {
		handlers,
		enableDiagnostics = false,
		diagnosticsIntervalMs = 30_000,
		audioPollIntervalMs = 2_000,
		staleCleanupIntervalMs = 5 * 60_000,
		getQueueSnapshot = emptyQueueSnapshot,
	} = options;

	const snapshot = {
		playlistActors: new Set<string>(),
		songActors: new Set<string>(),
		eventsHandled: 0,
		startedAt: Date.now(),
		timerEnabled: false,
		lastEvent: undefined as string | undefined,
		lastEventAt: undefined as number | undefined,
	};

	const actorRef = createActor(
		fromCallback<InternalRuntimeEvent>(({ receive }) => {
			let inFlight = Promise.resolve();

			const trackEvent = (type: string): void => {
				snapshot.eventsHandled += 1;
				snapshot.lastEvent = type;
				snapshot.lastEventAt = Date.now();
			};

			const runSafe = async (description: string, fn: () => Promise<void>) => {
				try {
					await fn();
				} catch (error: unknown) {
					logger.warn(
						{ err: error, event: description },
						"Worker runtime handler failed",
					);
				}
			};

			receive((event) => {
				trackEvent(event.type);
				inFlight = inFlight.then(() =>
					runSafe(event.type, async () => {
						switch (event.type) {
							case "supervisor.startup":
								await handlers.reconcileAceState();
								await handlers.startupSweep();
								if (enableDiagnostics) {
									await handlers.logWorkerDiagnostics("startup");
								}
								break;
							case "supervisor.tick_audio":
								await handlers.tickAudioPolls();
								break;
							case "supervisor.tick_stale":
								await handlers.staleSongCleanup();
								break;
							case "supervisor.tick_diagnostics":
								await handlers.logWorkerDiagnostics("interval");
								break;
							case "supervisor.stop":
								break;
							case "song.created":
								await handlers.handleSongCreated(event);
								break;
							case "song.status_changed":
								await handlers.handleSongStatusChanged(event);
								break;
							case "playlist.created":
								snapshot.playlistActors.add(event.playlistId);
								await handlers.handlePlaylistCreated(event);
								break;
							case "playlist.steered":
								await handlers.handlePlaylistSteered(event);
								break;
							case "playlist.heartbeat":
								snapshot.playlistActors.add(event.playlistId);
								await handlers.handlePlaylistHeartbeat(event);
								break;
							case "playlist.updated":
								snapshot.playlistActors.add(event.playlistId);
								await handlers.handlePlaylistUpdated(event);
								break;
							case "playlist.deleted":
								snapshot.playlistActors.delete(event.playlistId);
								await handlers.handlePlaylistDeleted(event);
								break;
							case "playlist.status_changed":
								snapshot.playlistActors.add(event.playlistId);
								await handlers.handlePlaylistStatusChanged(event);
								break;
							case "settings.changed":
								await handlers.handleSettingsChanged(event);
								break;
							case "playlist.actor.started":
								snapshot.playlistActors.add(event.playlistId);
								break;
							case "playlist.actor.stopped":
								snapshot.playlistActors.delete(event.playlistId);
								break;
							case "playlist.actor.cancel_all":
								break;
							case "playlist.actor.start_song":
								if (event.playlistId) {
									snapshot.playlistActors.add(event.playlistId);
								}
								snapshot.songActors.add(event.songId);
								break;
							case "playlist.actor.song-started":
								if (event.songId) snapshot.songActors.add(event.songId);
								break;
							case "playlist.actor.song-completed":
							case "playlist.actor.song-failed":
								snapshot.songActors.delete(event.songId);
								break;
							case "song.started":
								snapshot.songActors.add(event.songId);
								break;
							case "song.completed":
							case "song.failed":
								snapshot.songActors.delete(event.songId);
								break;
							default:
								logger.debug({ event }, "Unhandled worker runtime event");
						}
					}),
				);
			});
		}),
		{
			inspect: getWorkerInspectObserver(),
		},
	);

	let audioPollTimer: ReturnType<typeof setTimeout> | null = null;
	let staleCleanupTimer: ReturnType<typeof setTimeout> | null = null;
	let diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;
	let running = false;

	const clearTimers = () => {
		if (audioPollTimer) {
			clearInterval(audioPollTimer);
			audioPollTimer = null;
		}
		if (staleCleanupTimer) {
			clearInterval(staleCleanupTimer);
			staleCleanupTimer = null;
		}
		if (diagnosticsTimer) {
			clearInterval(diagnosticsTimer);
			diagnosticsTimer = null;
		}
		snapshot.timerEnabled = false;
	};

	return {
		async start(): Promise<void> {
			if (running) return;
			running = true;
			snapshot.startedAt = Date.now();
			actorRef.start();
			actorRef.send({ type: "supervisor.startup" });

			audioPollTimer = setInterval(() => {
				actorRef.send({ type: "supervisor.tick_audio" });
			}, audioPollIntervalMs);
			staleCleanupTimer = setInterval(() => {
				actorRef.send({ type: "supervisor.tick_stale" });
			}, staleCleanupIntervalMs);
			if (enableDiagnostics) {
				diagnosticsTimer = setInterval(() => {
					actorRef.send({ type: "supervisor.tick_diagnostics" });
				}, diagnosticsIntervalMs);
			}
			snapshot.timerEnabled = true;
		},
		stop(): void {
			if (!running) return;
			running = false;
			actorRef.send({ type: "supervisor.stop" });
			clearTimers();
			actorRef.stop();
		},
		send(event: WorkerRuntimeEvent): void {
			if (!running) return;
			actorRef.send(event);
		},
		getSnapshot(): WorkerActorRuntimeSnapshot {
			const queueSnapshot = getQueueSnapshot();
			return {
				playlistActors: [...snapshot.playlistActors],
				songActors: [...snapshot.songActors],
				eventsHandled: snapshot.eventsHandled,
				startedAt: snapshot.startedAt,
				lastEvent: snapshot.lastEvent,
				lastEventAt: snapshot.lastEventAt,
				timerEnabled: snapshot.timerEnabled,
				queueSnapshots: queueSnapshot,
			};
		},
	};
}
