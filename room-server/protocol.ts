import z from "zod";

// ─── Shared Types ───────────────────────────────────────────────────

export const DeviceRoleSchema = z.enum(["player", "controller"]);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const DeviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: DeviceRoleSchema,
});
export type Device = z.infer<typeof DeviceSchema>;

export const PlaybackStateSchema = z.object({
	currentSongId: z.string().nullable(),
	isPlaying: z.boolean(),
	currentTime: z.number(),
	duration: z.number(),
	volume: z.number(),
	isMuted: z.boolean(),
});
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

/** Lightweight song data sent over the wire (subset of Convex song doc). */
export const SongDataSchema = z.object({
	_id: z.string(),
	title: z.string().optional(),
	artistName: z.string().optional(),
	genre: z.string().optional(),
	subGenre: z.string().optional(),
	coverUrl: z.string().optional(),
	audioUrl: z.string().optional(),
	status: z.string(),
	orderIndex: z.number(),
	isInterrupt: z.boolean().optional(),
	promptEpoch: z.number().optional(),
	_creationTime: z.number(),
	audioDuration: z.number().optional(),
	mood: z.string().optional(),
	energy: z.string().optional(),
	era: z.string().optional(),
	vocalStyle: z.string().optional(),
	userRating: z.enum(["up", "down"]).optional(),
	bpm: z.number().optional(),
	keyScale: z.string().optional(),
	lyrics: z.string().optional(),
});
export type SongData = z.infer<typeof SongDataSchema>;

// ─── Client → Server Messages ───────────────────────────────────────

export const CommandActionSchema = z.enum([
	"play",
	"pause",
	"toggle",
	"skip",
	"seek",
	"setVolume",
	"toggleMute",
	"rate",
	"selectSong",
]);
export type CommandAction = z.infer<typeof CommandActionSchema>;

const JoinMessageSchema = z.object({
	type: z.literal("join"),
	roomId: z.string(),
	deviceId: z.string(),
	deviceName: z.string(),
	role: DeviceRoleSchema,
	playlistKey: z.string().optional(),
	roomName: z.string().optional(),
});

const CommandMessageSchema = z.object({
	type: z.literal("command"),
	action: CommandActionSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
	targetDeviceId: z.string().optional(),
});

const SyncMessageSchema = z.object({
	type: z.literal("sync"),
	currentSongId: z.string().nullable(),
	isPlaying: z.boolean(),
	currentTime: z.number(),
	duration: z.number(),
});

const SetRoleMessageSchema = z.object({
	type: z.literal("setRole"),
	role: DeviceRoleSchema,
});

const SongEndedMessageSchema = z.object({
	type: z.literal("songEnded"),
});

const RenameDeviceMessageSchema = z.object({
	type: z.literal("renameDevice"),
	targetDeviceId: z.string(),
	name: z.string().min(1).max(50),
});

const PingMessageSchema = z.object({
	type: z.literal("ping"),
	clientTime: z.number(),
});

export const ClientMessageSchema = z.union([
	JoinMessageSchema,
	CommandMessageSchema,
	SyncMessageSchema,
	SetRoleMessageSchema,
	SongEndedMessageSchema,
	RenameDeviceMessageSchema,
	PingMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client Messages ───────────────────────────────────────

const StateMessageSchema = z.object({
	type: z.literal("state"),
	playback: PlaybackStateSchema,
	currentSong: SongDataSchema.nullable(),
	devices: z.array(DeviceSchema),
});

const ExecuteMessageSchema = z.object({
	type: z.literal("execute"),
	action: CommandActionSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
});

const QueueMessageSchema = z.object({
	type: z.literal("queue"),
	songs: z.array(SongDataSchema),
});

const NextSongMessageSchema = z.object({
	type: z.literal("nextSong"),
	songId: z.string(),
	audioUrl: z.string(),
	startAt: z.number().optional(),
});

const PreloadMessageSchema = z.object({
	type: z.literal("preload"),
	songId: z.string(),
	audioUrl: z.string(),
});

const PongMessageSchema = z.object({
	type: z.literal("pong"),
	clientTime: z.number(),
	serverTime: z.number(),
});

const ErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});

export const ServerMessageSchema = z.union([
	StateMessageSchema,
	ExecuteMessageSchema,
	QueueMessageSchema,
	NextSongMessageSchema,
	PreloadMessageSchema,
	PongMessageSchema,
	ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── REST Schemas ───────────────────────────────────────────────────

export const RoomInfoSchema = z.object({
	id: z.string(),
	name: z.string(),
	playlistKey: z.string(),
	playlistId: z.string().optional(),
	deviceCount: z.number(),
	playback: PlaybackStateSchema,
	currentSong: SongDataSchema.nullable(),
});
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export const CreateRoomRequestSchema = z.object({
	id: z.string().regex(/^[a-z0-9-]+$/, "Room ID must be a lowercase slug"),
	name: z.string().min(1),
	playlistKey: z.string().min(1),
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const NowPlayingResponseSchema = z.object({
	text: z.string(),
	tooltip: z.string(),
	class: z.string(),
	song: SongDataSchema.nullable(),
	playback: PlaybackStateSchema,
	room: z.object({
		id: z.string(),
		name: z.string(),
		deviceCount: z.number(),
	}),
});
export type NowPlayingResponse = z.infer<typeof NowPlayingResponseSchema>;
