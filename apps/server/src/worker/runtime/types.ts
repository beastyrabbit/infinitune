import type { PlaylistWire, SongWire } from "../../wire";

export interface WorkerBusEventCommon {
	playlistId?: string;
	songId?: string;
}

export interface SongCreatedEvent extends WorkerBusEventCommon {
	type: "song.created";
	songId: string;
	playlistId: string;
	status: string;
}

export interface SongStatusChangedEvent extends WorkerBusEventCommon {
	type: "song.status_changed";
	songId: string;
	playlistId: string;
	from: string;
	to: string;
}

export interface PlaylistCreatedEvent extends WorkerBusEventCommon {
	type: "playlist.created";
	playlistId: string;
}

export interface PlaylistSteeredEvent extends WorkerBusEventCommon {
	type: "playlist.steered";
	playlistId: string;
	newEpoch: number;
}

export interface PlaylistHeartbeatEvent extends WorkerBusEventCommon {
	type: "playlist.heartbeat";
	playlistId: string;
}

export interface PlaylistUpdatedEvent extends WorkerBusEventCommon {
	type: "playlist.updated";
	playlistId: string;
}

export interface PlaylistStatusChangedEvent extends WorkerBusEventCommon {
	type: "playlist.status_changed";
	playlistId: string;
	from: string;
	to: string;
}

export interface PlaylistDeletedEvent extends WorkerBusEventCommon {
	type: "playlist.deleted";
	playlistId: string;
}

export interface SettingsChangedEvent {
	type: "settings.changed";
	key: string;
}

export type WorkerBusEvent =
	| SongCreatedEvent
	| SongStatusChangedEvent
	| PlaylistCreatedEvent
	| PlaylistSteeredEvent
	| PlaylistHeartbeatEvent
	| PlaylistUpdatedEvent
	| PlaylistStatusChangedEvent
	| PlaylistDeletedEvent
	| SettingsChangedEvent;

export interface QueueEvent {
	type:
		| "queue.enqueue"
		| "queue.cancel"
		| "queue.updatePriority"
		| "queue.recalc";
	taskType: "llm" | "image" | "audio";
	songId?: string;
	endpoint?: string;
	priority?: number;
	task?: unknown;
}

export interface SongEvent {
	type: "song.started" | "song.completed" | "song.failed";
	songId: string;
	playlistId: string;
	error?: string;
}

export interface PlaylistEvent {
	type:
		| "playlist.actor.started"
		| "playlist.actor.stopped"
		| "playlist.actor.cancel_all";
	playlistId: string;
}

export interface WorkerSongStartInput {
	type: "playlist.actor.start_song";
	songId: string;
	playlistId: string;
	status: string;
	song: SongWire;
	playlist: PlaylistWire;
	recentCompleted: Array<{
		title: string;
		artistName: string;
		genre: string;
		subGenre: string;
		vocalStyle: string | null;
		mood: string | null;
		energy: string | null;
	}>;
	recentDescriptions: string[];
}

export interface QueueSnapshot {
	pending: number;
	active: number;
	errors: number;
	oldestActiveAgeMs?: number;
	oldestPendingAgeMs?: number;
	lastErrorMessage?: string;
}

export interface WorkerActorRuntimeSnapshot {
	playlistActors: string[];
	songActors: string[];
	eventsHandled: number;
	startedAt: number;
	lastEvent?: string;
	lastEventAt?: number;
	timerEnabled: boolean;
	queueSnapshots: {
		llm: QueueSnapshot;
		image: QueueSnapshot;
		audio: QueueSnapshot;
	};
}

export interface AudioPollResult {
	status: "running" | "succeeded" | "failed" | "not_found";
	audioPath?: string;
	error?: string;
}

export interface ProviderTaskPorts {
	generateMetadata: {
		prompt: string;
		provider: string;
		model: string;
		lyricsLanguage?: string;
		managerBrief?: string;
		managerSlot?: {
			slot: number;
			transitionPolicy?: string;
			transitionIntent?: string;
			topicHint?: string;
			captionFocus?: string;
			lyricTheme?: string;
			energyTarget?: string;
		};
		managerTransitionPolicy?: string;
		targetBpm?: number;
		targetKey?: string;
		timeSignature?: string;
		audioDuration?: number;
		recentSongs?: Array<{
			title: string;
			artistName: string;
			genre: string;
			subGenre: string;
			vocalStyle?: string | null;
			mood?: string | null;
			energy?: string | null;
		}>;
		recentDescriptions?: string[];
		isInterrupt?: boolean;
		promptDistance?: "close" | "general" | "faithful" | "album";
		promptProfile?: "strict" | "balanced" | "creative" | "compact";
		promptMode?: "full" | "minimal" | "none";
		signal?: AbortSignal;
	};
	generatePersona: {
		song: {
			title: string;
			artistName: string;
			genre: string;
			subGenre: string;
			mood?: string | null;
			energy?: string | null;
			era?: string | null;
			vocalStyle?: string | null;
			instruments?: string[] | null;
			themes?: string[] | null;
			description?: string | null;
			lyrics?: string | null;
		};
		provider: string;
		model: string;
		signal?: AbortSignal;
	};
	generateCover: {
		coverPrompt: string;
		provider: string;
		model?: string;
		signal?: AbortSignal;
	};
	submitAudio: {
		lyrics: string;
		caption: string;
		vocalStyle?: string;
		bpm: number;
		keyScale: string;
		timeSignature: string;
		audioDuration: number;
		aceModel?: string;
		inferenceSteps?: number;
		vocalLanguage?: string;
		lmTemperature?: number;
		lmCfgScale?: number;
		inferMethod?: string;
		signal?: AbortSignal;
	};
	pollAudio: {
		taskId: string;
		signal?: AbortSignal;
	};
	batchPollAudio: {
		taskIds: string[];
		signal?: AbortSignal;
	};
}

export interface ProviderCapability {
	generateMetadata: (
		input: ProviderTaskPorts["generateMetadata"],
	) => Promise<unknown>;
	generatePersona: (
		input: ProviderTaskPorts["generatePersona"],
	) => Promise<string>;
	generateCover: (
		input: ProviderTaskPorts["generateCover"],
	) => Promise<unknown>;
	submitAudio: (
		input: ProviderTaskPorts["submitAudio"],
	) => Promise<{ taskId: string }>;
	pollAudio: (
		input: ProviderTaskPorts["pollAudio"],
	) => Promise<AudioPollResult>;
	batchPollAudio: (
		input: ProviderTaskPorts["batchPollAudio"],
	) => Promise<Map<string, AudioPollResult>>;
}

export interface WorkerRuntimeEventBase {
	type: string;
}

export type WorkerRuntimeEvent =
	| WorkerBusEvent
	| {
			type: "supervisor.startup";
	  }
	| {
			type: "supervisor.tick";
	  }
	| {
			type: "supervisor.stop";
	  }
	| SongEvent
	| PlaylistEvent
	| WorkerSongStartInput
	| {
			type: "playlist.actor.song-started";
			playlistId: string;
			songId: string;
	  }
	| {
			type: "playlist.actor.song-completed";
			playlistId: string;
			songId: string;
	  }
	| {
			type: "playlist.actor.song-failed";
			playlistId: string;
			songId: string;
			error?: string;
	  };
