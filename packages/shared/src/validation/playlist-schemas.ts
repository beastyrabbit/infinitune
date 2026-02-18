import z from "zod";
import { SUPPORTED_LYRICS_LANGUAGES } from "../lyrics-language";
import { LLM_PROVIDERS, PLAYLIST_MODES, PLAYLIST_STATUSES } from "../types";

/** Schema for creating a playlist */
export const CreatePlaylistSchema = z.object({
	name: z.string().min(1),
	prompt: z.string().min(1),
	llmProvider: z.string().min(1),
	llmModel: z.string().min(1),
	mode: z.enum(PLAYLIST_MODES).optional().default("endless"),
	playlistKey: z.string().optional(),
	lyricsLanguage: z.enum(SUPPORTED_LYRICS_LANGUAGES).optional(),
	targetBpm: z.number().min(30).max(300).optional(),
	targetKey: z.string().optional(),
	timeSignature: z.string().optional(),
	audioDuration: z.number().min(10).max(600).optional(),
	inferenceSteps: z.number().int().min(1).max(200).optional(),
	lmTemperature: z.number().min(0).max(2).optional(),
	lmCfgScale: z.number().min(0).max(20).optional(),
	inferMethod: z.string().optional(),
});

/** Schema for updating playlist status */
export const UpdatePlaylistStatusSchema = z.object({
	status: z.enum(PLAYLIST_STATUSES),
});

/** Schema for updating playlist prompt (steering) */
export const UpdatePlaylistPromptSchema = z.object({
	prompt: z.string().min(1),
});

/** Schema for updating playlist position */
export const UpdatePlaylistPositionSchema = z.object({
	currentOrderIndex: z.number().min(0),
});

/** Schema for updating generation params */
export const UpdatePlaylistParamsSchema = z.object({
	llmProvider: z.enum(LLM_PROVIDERS).optional(),
	llmModel: z.string().nullable().optional(),
	lyricsLanguage: z.enum(SUPPORTED_LYRICS_LANGUAGES).nullable().optional(),
	targetBpm: z.number().min(30).max(300).nullable().optional(),
	targetKey: z.string().nullable().optional(),
	timeSignature: z.string().nullable().optional(),
	audioDuration: z.number().min(10).max(600).nullable().optional(),
	inferenceSteps: z.number().int().min(1).max(200).nullable().optional(),
	lmTemperature: z.number().min(0).max(2).nullable().optional(),
	lmCfgScale: z.number().min(0).max(20).nullable().optional(),
	inferMethod: z.string().nullable().optional(),
});

/** Schema for setting a key-value setting */
export const SetSettingSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});
