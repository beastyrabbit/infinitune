import z from "zod";
import { ACE_DCW_MODES, isValidAceModel } from "../ace-settings";
import {
	getAgentReasoningSettingKey,
	INFINITUNE_AGENT_IDS,
} from "../agent-reasoning";
import { SUPPORTED_LYRICS_LANGUAGES } from "../lyrics-language";
import { PLAYLIST_MODES, PLAYLIST_STATUSES } from "../types";

// Updates accept current providers and stored legacy values. The server
// normalizes removed providers before persistence.
const UPDATE_LLM_PROVIDERS = [
	"openai-codex",
	"anthropic",
	"ollama",
	"openrouter",
] as const;

const AceModelSchema = z
	.string()
	.max(128)
	.refine(isValidAceModel, "Invalid ACE-Step model identifier");
const AceDcwWaveletSchema = z.string().min(1).max(64);

/** Schema for creating a playlist */
export const CreatePlaylistSchema = z.object({
	name: z.string().min(1),
	prompt: z.string().min(1),
	llmProvider: z.string().min(1),
	llmModel: z.string(),
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
	aceModel: AceModelSchema.optional(),
	aceDcwEnabled: z.boolean().optional(),
	aceDcwMode: z.enum(ACE_DCW_MODES).optional(),
	aceDcwScaler: z.number().min(0).max(1).optional(),
	aceDcwHighScaler: z.number().min(0).max(1).optional(),
	aceDcwWavelet: AceDcwWaveletSchema.optional(),
	aceThinking: z.boolean().optional(),
	aceAutoDuration: z.boolean().optional(),
	ownerUserId: z.string().optional(),
	isTemporary: z.boolean().optional(),
	expiresAt: z.number().optional(),
	description: z.string().max(4000).optional(),
	initialDirectorPlan: z.boolean().optional(),
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
	llmProvider: z.enum(UPDATE_LLM_PROVIDERS).optional(),
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
	aceModel: AceModelSchema.nullable().optional(),
	aceDcwEnabled: z.boolean().nullable().optional(),
	aceDcwMode: z.enum(ACE_DCW_MODES).nullable().optional(),
	aceDcwScaler: z.number().min(0).max(1).nullable().optional(),
	aceDcwHighScaler: z.number().min(0).max(1).nullable().optional(),
	aceDcwWavelet: AceDcwWaveletSchema.nullable().optional(),
	aceThinking: z.boolean().nullable().optional(),
	aceAutoDuration: z.boolean().nullable().optional(),
});

/** Global settings the web UI writes through POST /api/settings. */
const WRITABLE_SETTING_KEYS = new Set<string>([
	"volume",
	"ollamaUrl",
	"aceStepUrl",
	"textProvider",
	"textModel",
	"imageProvider",
	"imageModel",
	"coversEnabled",
	"personaProvider",
	"personaModel",
	"aceModel",
	"aceVaeCheckpoint",
	"aceInferenceSteps",
	"aceLmTemperature",
	"aceLmCfgScale",
	"aceInferMethod",
	"aceGuidanceScale",
	"aceSamplerMode",
	"aceShift",
	"aceVelocityNormThreshold",
	"aceVelocityEmaFactor",
	"aceUseAdg",
	"aceQueueDepth",
	"aceDcwEnabled",
	"aceDcwMode",
	"aceDcwScaler",
	"aceDcwHighScaler",
	"aceDcwWavelet",
	"aceThinking",
	"aceAutoDuration",
	"radioCoversPerAlbum",
	"radioNewPerAlbum",
	"radioCoverOfCoverPerAlbum",
	"radioRandomFill",
	"radioSearchRatio",
	"radioSourceLibraryDir",
	"radioCoverNoiseStrength",
	...INFINITUNE_AGENT_IDS.map(getAgentReasoningSettingKey),
]);

/** Settings the server fetches; they must stay plain http(s) URLs. */
const URL_SETTING_KEYS = new Set(["ollamaUrl", "aceStepUrl"]);

const MAX_SETTING_VALUE_LENGTH = 4096;

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

/** Schema for setting a key-value setting */
export const SetSettingSchema = z
	.object({
		key: z.string().min(1),
		value: z.string().max(MAX_SETTING_VALUE_LENGTH),
	})
	.superRefine(({ key, value }, ctx) => {
		if (!WRITABLE_SETTING_KEYS.has(key)) {
			ctx.addIssue({
				code: "custom",
				path: ["key"],
				message: `Unknown setting: ${key}`,
			});
			return;
		}
		const trimmed = value.trim();
		if (URL_SETTING_KEYS.has(key) && trimmed && !isHttpUrl(trimmed)) {
			ctx.addIssue({
				code: "custom",
				path: ["value"],
				message: `${key} must be an absolute http(s) URL`,
			});
		}
	});
