/**
 * Shared wire types used by API server, worker, room server, and frontend.
 */
export const SONG_STATUSES = [
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"generating_audio",
	"saving",
	"ready",
	"played",
	"error",
	"retry_pending",
] as const;

export type SongStatus = (typeof SONG_STATUSES)[number];

export const TRANSIENT_STATUSES: SongStatus[] = [
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"generating_audio",
	"saving",
	"retry_pending",
];

export const ACTIVE_STATUSES: SongStatus[] = [
	"pending",
	"generating_metadata",
	"metadata_ready",
	"submitting_to_ace",
	"generating_audio",
	"saving",
	"ready",
];

export const PLAYLIST_MODES = ["endless", "oneshot"] as const;
export type PlaylistMode = (typeof PLAYLIST_MODES)[number];

export const PLAYLIST_STATUSES = ["active", "closing", "closed"] as const;
export type PlaylistStatus = (typeof PLAYLIST_STATUSES)[number];

export const LLM_PROVIDERS = ["ollama", "openrouter", "openai-codex"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * Type alias for IDs — replaces Convex Id<"table"> usage.
 * All IDs are cuid2 strings.
 */
export type Id<_T extends string> = string;

export interface PlaylistManagerPlanSlot {
	slot: number;
	transitionIntent: string;
	topicHint: string;
	captionFocus: string;
	lyricTheme: string;
	energyTarget: "low" | "medium" | "high" | "extreme";
}

export interface PlaylistManagerPlan {
	version: number;
	epoch: number;
	startOrderIndex?: number;
	windowSize: number;
	strategySummary: string;
	transitionPolicy: string;
	avoidPatterns: string[];
	slots: PlaylistManagerPlanSlot[];
	updatedAt: number;
}

// ─── Wire types (what the API returns) ──────────────────────────────

export interface Song {
	id: string;
	createdAt: number;
	playlistId: string;
	orderIndex: number;
	title: string | null;
	artistName: string | null;
	genre: string | null;
	subGenre: string | null;
	lyrics: string | null;
	caption: string | null;
	coverPrompt: string | null;
	coverUrl: string | null;
	bpm: number | null;
	keyScale: string | null;
	timeSignature: string | null;
	audioDuration: number | null;
	vocalStyle: string | null;
	mood: string | null;
	energy: string | null;
	era: string | null;
	instruments: string[] | undefined;
	tags: string[] | undefined;
	themes: string[] | undefined;
	language: string | null;
	description: string | null;
	status: SongStatus;
	aceTaskId: string | null;
	aceSubmittedAt: number | null;
	audioUrl: string | null;
	storagePath: string | null;
	aceAudioPath: string | null;
	errorMessage: string | null;
	retryCount: number | null;
	erroredAtStatus: string | null;
	cancelledAtStatus: string | null;
	generationStartedAt: number | null;
	generationCompletedAt: number | null;
	isInterrupt: boolean | null;
	interruptPrompt: string | null;
	llmProvider: string | null;
	llmModel: string | null;
	promptEpoch: number | null;
	userRating: "up" | "down" | null;
	playDurationMs: number | null;
	listenCount: number | null;
	metadataProcessingMs: number | null;
	coverProcessingMs: number | null;
	audioProcessingMs: number | null;
	personaExtract: string | null;
}

export interface Playlist {
	id: string;
	createdAt: number;
	name: string;
	prompt: string;
	llmProvider: string;
	llmModel: string;
	mode: string;
	status: PlaylistStatus;
	songsGenerated: number;
	playlistKey: string | null;
	lyricsLanguage: string | null;
	targetBpm: number | null;
	targetKey: string | null;
	timeSignature: string | null;
	audioDuration: number | null;
	inferenceSteps: number | null;
	lmTemperature: number | null;
	lmCfgScale: number | null;
	inferMethod: string | null;
	currentOrderIndex: number | null;
	lastSeenAt: number | null;
	promptEpoch: number | null;
	steerHistory?: Array<{ epoch: number; direction: string; at: number }>;
	managerBrief: string | null;
	managerPlan: PlaylistManagerPlan | null;
	managerEpoch: number | null;
	managerUpdatedAt: number | null;
	isStarred: boolean;
	ownerUserId: string | null;
	isTemporary: boolean;
	expiresAt: number | null;
	description: string | null;
	descriptionUpdatedAt: number | null;
}

export interface WorkQueue {
	pending: Song[];
	metadataReady: Song[];
	needsCover: Song[];
	generatingAudio: Song[];
	retryPending: Song[];
	needsRecovery: Song[];
	bufferDeficit: number;
	maxOrderIndex: number;
	totalSongs: number;
	transientCount: number;
	currentEpoch: number;
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
	staleSongs: Array<{ id: string; status: string; title: string | null }>;
}

export interface NeedsPersonaSong {
	id: string;
	title: string;
	artistName: string | null;
	genre: string | null;
	subGenre: string | null;
	mood: string | null;
	energy: string | null;
	era: string | null;
	vocalStyle: string | null;
	instruments: string[] | undefined;
	themes: string[] | undefined;
	description: string | null;
	lyrics: string | null;
}
