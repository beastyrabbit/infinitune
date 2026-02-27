import { createActor, fromCallback } from "xstate";
import { logger } from "../../logger";
import { getWorkerInspectObserver } from "./inspection";

export interface SongActorHandlers {
	cancelSong?(songId: string): Promise<void> | void;
	handleSongEvent?(
		data:
			| {
					type: "song.created";
					songId: string;
					playlistId: string;
					status: string;
			  }
			| {
					type: "song.status_changed";
					songId: string;
					playlistId: string;
					from: string;
					to: string;
			  },
	): Promise<void>;
	/** @deprecated fallback for existing direct callbacks */
	handleSongCreated?(data: {
		songId: string;
		playlistId: string;
		status: string;
	}): Promise<void>;
	/** @deprecated fallback for existing direct callbacks */
	handleSongStatusChanged?(data: {
		songId: string;
		playlistId: string;
		from: string;
		to: string;
	}): Promise<void>;
	onStopped?(): void;
}

export type SongActorEvent =
	| {
			type: "song.created";
			songId: string;
			playlistId: string;
			status: string;
	  }
	| {
			type: "song.status_changed";
			songId: string;
			playlistId: string;
			from: string;
			to: string;
	  }
	| { type: "song.actor.stop"; songId: string };

export interface SongActorSnapshot {
	songId: string;
	status: "running" | "stopped";
	eventsHandled: number;
	lastEvent?: string;
	lastEventAt?: number;
}

interface SongActorRuntime {
	songId: string;
	handlers: SongActorHandlers;
}

export function createSongActor(input: SongActorRuntime) {
	const snapshot = {
		status: "running" as "running" | "stopped",
		eventsHandled: 0,
		lastEvent: undefined as string | undefined,
		lastEventAt: undefined as number | undefined,
	};

	const actor = createActor(
		fromCallback<SongActorEvent>(({ receive, self }) => {
			let inFlight = Promise.resolve();
			let stopped = false;

			const runSafe = async (description: string, fn: () => Promise<void>) => {
				snapshot.eventsHandled += 1;
				snapshot.lastEvent = description;
				snapshot.lastEventAt = Date.now();

				if (stopped) return;

				try {
					await fn();
				} catch (error: unknown) {
					logger.warn(
						{ err: error, event: description, songId: input.songId },
						"Song actor handler failed",
					);
				}
			};

			const enqueue = (event: SongActorEvent) => {
				inFlight = inFlight.then(() => {
					switch (event.type) {
						case "song.actor.stop":
							stopped = true;
							if (input.handlers.cancelSong) {
								void input.handlers.cancelSong(event.songId);
							}
							snapshot.status = "stopped";
							input.handlers.onStopped?.();
							self.stop();
							return Promise.resolve();
						case "song.created":
							return runSafe(event.type, () => {
								if (input.handlers.handleSongEvent) {
									return input.handlers.handleSongEvent(event);
								}
								return input.handlers.handleSongCreated
									? input.handlers.handleSongCreated(event)
									: Promise.resolve();
							});
						case "song.status_changed":
							return runSafe(event.type, () => {
								if (input.handlers.handleSongEvent) {
									return input.handlers.handleSongEvent(event);
								}
								return input.handlers.handleSongStatusChanged
									? input.handlers.handleSongStatusChanged(event)
									: Promise.resolve();
							});
					}
				});
			};

			receive((event) => {
				enqueue(event);
			});
		}),
		{ inspect: getWorkerInspectObserver() },
	);

	return {
		ref: actor,
		getSnapshot(): SongActorSnapshot {
			return {
				songId: input.songId,
				...snapshot,
			};
		},
	};
}
