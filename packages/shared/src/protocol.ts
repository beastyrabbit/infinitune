import z from "zod";

export const ROOM_PROTOCOL_VERSION = 1 as const;

// ─── Shared Types ───────────────────────────────────────────────────

export const DeviceRoleSchema = z.enum(["player", "controller"]);
export type DeviceRole = z.infer<typeof DeviceRoleSchema>;

export const DeviceModeSchema = z.enum(["default", "individual"]);
export type DeviceMode = z.infer<typeof DeviceModeSchema>;

export const DeviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: DeviceRoleSchema,
	mode: DeviceModeSchema.default("default"),
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
	id: z.string(),
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
	createdAt: z.number(),
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
	"stop",
	"toggle",
	"skip",
	"seek",
	"setVolume",
	"toggleMute",
	"rate",
	"selectSong",
	"resetToDefault",
	"syncAll",
]);
export type CommandAction = z.infer<typeof CommandActionSchema>;

const JoinMessageSchema = z
	.object({
		type: z.literal("join"),
		// `roomId` is kept for backward compatibility with existing clients.
		roomId: z.string().optional(),
		// `playlistId` is the preferred identifier for new clients.
		playlistId: z.string().optional(),
		deviceId: z.string(),
		deviceName: z.string(),
		role: DeviceRoleSchema,
		playlistKey: z.string().optional(),
		roomName: z.string().optional(),
		protocolVersion: z.number().int().positive().optional(),
	})
	.refine((value) => Boolean(value.roomId || value.playlistId), {
		message: "join requires roomId or playlistId",
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
	protocolVersion: z.number().int().positive().optional(),
});

const JoinAckMessageSchema = z.object({
	type: z.literal("joinAck"),
	roomId: z.string(),
	playlistId: z.string().optional(),
	deviceId: z.string(),
	protocolVersion: z.number().int().positive(),
});

const ExecuteMessageSchema = z.object({
	type: z.literal("execute"),
	action: CommandActionSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
	scope: z.enum(["room", "device"]).default("room"),
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
	JoinAckMessageSchema,
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

// ─── Backend-first control plane schemas ───────────────────────────

export const AuthSessionSchema = z.object({
	authenticated: z.boolean(),
	userId: z.string().nullable(),
	email: z.string().nullable().optional(),
	name: z.string().nullable().optional(),
	picture: z.string().nullable().optional(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const DeviceRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	ownerUserId: z.string().nullable(),
	lastSeenAt: z.number().nullable(),
	createdAt: z.number(),
	daemonVersion: z.string().nullable().optional(),
	capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>;

export const IssueDeviceTokenRequestSchema = z.object({
	name: z.string().min(1).max(120),
});
export type IssueDeviceTokenRequest = z.infer<
	typeof IssueDeviceTokenRequestSchema
>;

export const IssueDeviceTokenResponseSchema = z.object({
	device: DeviceRecordSchema,
	token: z.string(),
});
export type IssueDeviceTokenResponse = z.infer<
	typeof IssueDeviceTokenResponseSchema
>;

export const DeviceRegisterRequestSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	daemonVersion: z.string().optional(),
	capabilities: z.record(z.string(), z.unknown()).optional(),
});
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequestSchema>;

export const DeviceRegisterResponseSchema = z.object({
	device: DeviceRecordSchema,
	assignedPlaylistId: z.string().nullable(),
});
export type DeviceRegisterResponse = z.infer<
	typeof DeviceRegisterResponseSchema
>;

export const PlaylistSessionInfoSchema = z.object({
	playlistId: z.string(),
	playlistKey: z.string().nullable(),
	playlistName: z.string(),
	playback: PlaybackStateSchema,
	currentSong: SongDataSchema.nullable(),
	devices: z.array(DeviceSchema),
	queue: z.array(SongDataSchema),
});
export type PlaylistSessionInfo = z.infer<typeof PlaylistSessionInfoSchema>;

export const PlaylistCommandRequestSchema = z.object({
	playlistId: z.string(),
	action: CommandActionSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
	targetDeviceId: z.string().optional(),
	scope: z.enum(["playlist", "device"]).optional().default("playlist"),
});
export type PlaylistCommandRequest = z.infer<
	typeof PlaylistCommandRequestSchema
>;

export const HouseCommandRequestSchema = z.object({
	action: CommandActionSchema,
	payload: z.record(z.string(), z.unknown()).optional(),
	targetDeviceId: z.string().optional(),
	playlistIds: z.array(z.string()).optional(),
});
export type HouseCommandRequest = z.infer<typeof HouseCommandRequestSchema>;

export const HouseCommandResponseSchema = z.object({
	ok: z.boolean(),
	affectedPlaylistIds: z.array(z.string()),
	affectedRoomIds: z.array(z.string()),
	skippedPlaylistIds: z.array(z.string()),
});
export type HouseCommandResponse = z.infer<typeof HouseCommandResponseSchema>;

export const HouseSessionSchema = PlaylistSessionInfoSchema.extend({
	roomId: z.string(),
});
export type HouseSession = z.infer<typeof HouseSessionSchema>;

export const HouseSessionsResponseSchema = z.object({
	sessions: z.array(HouseSessionSchema),
});
export type HouseSessionsResponse = z.infer<typeof HouseSessionsResponseSchema>;

export const PlaylistDeviceAssignmentSchema = z.object({
	playlistId: z.string(),
	deviceId: z.string(),
	isActive: z.boolean(),
	assignedAt: z.number(),
});
export type PlaylistDeviceAssignment = z.infer<
	typeof PlaylistDeviceAssignmentSchema
>;

export const PlaylistDeviceAssignmentsResponseSchema = z.object({
	playlistId: z.string(),
	assignments: z.array(PlaylistDeviceAssignmentSchema),
	activeDevices: z.array(DeviceSchema),
});
export type PlaylistDeviceAssignmentsResponse = z.infer<
	typeof PlaylistDeviceAssignmentsResponseSchema
>;
