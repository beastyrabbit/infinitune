import { createActor, fromCallback } from "xstate";
import { logger } from "../../logger";
import { getWorkerInspectObserver } from "./inspection";

export interface PlaylistActorHandlers {
	cancelPlaylistSongs?(playlistId: string): Promise<void> | void;
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
	onStopped?(): void;
}

export type PlaylistActorEvent =
	| { type: "playlist.created"; playlistId: string }
	| { type: "playlist.steered"; playlistId: string; newEpoch: number }
	| { type: "playlist.heartbeat"; playlistId: string }
	| { type: "playlist.updated"; playlistId: string }
	| { type: "playlist.deleted"; playlistId: string }
	| {
			type: "playlist.status_changed";
			playlistId: string;
			from: string;
			to: string;
	  }
	| { type: "playlist.actor.stop"; playlistId: string };

export interface PlaylistActorSnapshot {
	playlistId: string;
	status: "running" | "stopped";
	eventsHandled: number;
	lastEvent?: string;
	lastEventAt?: number;
}

interface PlaylistActorRuntime {
	playlistId: string;
	handlers: PlaylistActorHandlers;
}

export function createPlaylistActor(input: PlaylistActorRuntime) {
	const snapshot = {
		status: "running" as "running" | "stopped",
		eventsHandled: 0,
		lastEvent: undefined as string | undefined,
		lastEventAt: undefined as number | undefined,
	};

	const actor = createActor(
		fromCallback<PlaylistActorEvent>(({ receive, self }) => {
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
						{ err: error, event: description, playlistId: input.playlistId },
						"Playlist actor handler failed",
					);
				}
			};

			const enqueue = (event: PlaylistActorEvent) => {
				inFlight = inFlight.then(() => {
					switch (event.type) {
						case "playlist.actor.stop":
							stopped = true;
							if (input.handlers.cancelPlaylistSongs) {
								void input.handlers.cancelPlaylistSongs(input.playlistId);
							}
							snapshot.status = "stopped";
							input.handlers.onStopped?.();
							self.stop();
							return Promise.resolve();
						case "playlist.created":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistCreated(event),
							);
						case "playlist.steered":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistSteered(event),
							);
						case "playlist.heartbeat":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistHeartbeat(event),
							);
						case "playlist.updated":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistUpdated(event),
							);
						case "playlist.deleted":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistDeleted(event),
							);
						case "playlist.status_changed":
							return runSafe(event.type, () =>
								input.handlers.handlePlaylistStatusChanged(event),
							);
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
		getSnapshot(): PlaylistActorSnapshot {
			return {
				playlistId: input.playlistId,
				...snapshot,
			};
		},
	};
}
