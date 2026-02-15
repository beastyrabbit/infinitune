import z from "zod";
import { SONG_STATUSES } from "../types";

/** Schema for creating a pending song */
export const CreatePendingSongSchema = z.object({
	playlistId: z.string().min(1),
	orderIndex: z.number().int().positive(),
	isInterrupt: z.boolean().optional(),
	interruptPrompt: z.string().optional(),
	promptEpoch: z.number().int().min(0).optional(),
});

/** Schema for updating song status */
export const UpdateSongStatusSchema = z.object({
	status: z.enum(SONG_STATUSES),
	errorMessage: z.string().optional(),
});

/** Schema for completing metadata */
export const CompleteSongMetadataSchema = z.object({
	title: z.string().min(1),
	artistName: z.string().min(1),
	genre: z.string().min(1),
	subGenre: z.string().min(1),
	lyrics: z.string(),
	caption: z.string(),
	coverPrompt: z.string().optional(),
	bpm: z.number().min(30).max(300),
	keyScale: z.string().min(1),
	timeSignature: z.string().min(1),
	audioDuration: z.number().min(10).max(600),
	vocalStyle: z.string().optional(),
	mood: z.string().optional(),
	energy: z.string().optional(),
	era: z.string().optional(),
	instruments: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	themes: z.array(z.string()).optional(),
	language: z.string().optional(),
	description: z.string().optional(),
	llmProvider: z.string().optional(),
	llmModel: z.string().optional(),
	metadataProcessingMs: z.number().optional(),
});

/** Schema for marking a song as ready */
export const MarkSongReadySchema = z.object({
	audioUrl: z.string().min(1),
	audioProcessingMs: z.number().optional(),
});

/** Schema for marking an error */
export const MarkSongErrorSchema = z.object({
	errorMessage: z.string().min(1),
	erroredAtStatus: z.string().optional(),
});

/** Schema for rating a song */
export const RateSongSchema = z.object({
	rating: z.enum(["up", "down"]),
});

/** Schema for ACE task update */
export const UpdateAceTaskSchema = z.object({
	aceTaskId: z.string().min(1),
});

/** Schema for cover URL update */
export const UpdateCoverSchema = z.object({
	coverUrl: z.string().min(1),
});

/** Schema for cover upload */
export const UploadCoverSchema = z.object({
	imageBase64: z.string().min(1),
});

/** Schema for play duration */
export const PlayDurationSchema = z.object({
	durationMs: z.number().positive(),
});

/** Schema for song reorder */
export const ReorderSongSchema = z.object({
	newOrderIndex: z.number().positive(),
});

/** Schema for storage path update */
export const UpdateStoragePathSchema = z.object({
	storagePath: z.string().min(1),
	aceAudioPath: z.string().optional(),
});

/** Schema for audio duration update */
export const UpdateAudioDurationSchema = z.object({
	audioDuration: z.number().positive(),
});

/** Schema for cover processing time */
export const UpdateCoverProcessingMsSchema = z.object({
	coverProcessingMs: z.number().min(0),
});

/** Schema for persona extract update */
export const UpdatePersonaExtractSchema = z.object({
	personaExtract: z.string().min(1),
});
