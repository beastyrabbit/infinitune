import { resolveTextLlmProfile } from "@infinitune/shared/text-llm-profile";
import type { PlaylistManagerPlanSlot } from "@infinitune/shared/types";
import { batchPollAce, pollAce, submitToAce } from "../../external/ace";
import { generateCover } from "../../external/cover";
import {
	generatePersonaExtract,
	generateSongMetadata,
	type SongMetadata,
} from "../../external/llm";
import { logger } from "../../logger";
import type { ProviderCapability, ProviderTaskPorts } from "./types";

export interface ProviderConfig {
	textProvider: string;
	textModel: string;
	imageProvider: string;
	imageModel?: string;
	personaProvider: string;
	personaModel: string;
}

type OptionalStringList = string[] | undefined | null;
type EnergyTarget = PlaylistManagerPlanSlot["energyTarget"];
type NoveltyTarget = Extract<
	PlaylistManagerPlanSlot,
	{ noveltyTarget: string }
>["noveltyTarget"];

function normalizeProvider(provider: string) {
	const { provider: normalized } = resolveTextLlmProfile({
		provider,
		model: "",
	});
	return normalized;
}

function normalizeEnergyTarget(value: unknown): EnergyTarget {
	return value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "extreme"
		? value
		: "medium";
}

function normalizeNoveltyTarget(value: unknown): NoveltyTarget {
	return value === "low" || value === "medium" || value === "high"
		? value
		: "medium";
}

function normalizeSlotText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeSlotList(value: unknown): string[] {
	return Array.isArray(value)
		? value.flatMap((item) => {
				const text = normalizeSlotText(item);
				return text ? [text] : [];
			})
		: [];
}

function isV2ManagerSlot(
	slot: PlaylistManagerPlanSlot,
): slot is Extract<PlaylistManagerPlanSlot, { laneId: string }> {
	return "laneId" in slot;
}

function normalizeManagerSlot(
	slot?: ProviderTaskPorts["generateMetadata"]["managerSlot"],
): PlaylistManagerPlanSlot | undefined {
	if (!slot) return undefined;
	const energyTarget = normalizeEnergyTarget(slot.energyTarget);
	if (isV2ManagerSlot(slot)) {
		const sonicFocus = normalizeSlotText(slot.sonicFocus) || slot.captionFocus;
		const lyricFocus = normalizeSlotText(slot.lyricFocus) || slot.lyricTheme;
		return {
			slot: slot.slot,
			laneId: normalizeSlotText(slot.laneId) || `slot-${slot.slot}`,
			preservedAnchors: normalizeSlotList(slot.preservedAnchors),
			variationMoves: normalizeSlotList(slot.variationMoves),
			sonicFocus: sonicFocus ?? "",
			lyricFocus: lyricFocus ?? "",
			captionFocus: normalizeSlotText(slot.captionFocus) || sonicFocus || "",
			energyTarget,
			noveltyTarget: normalizeNoveltyTarget(slot.noveltyTarget),
			avoidPatterns: normalizeSlotList(slot.avoidPatterns),
			transitionIntent: normalizeSlotText(slot.transitionIntent),
			topicHint:
				normalizeSlotText(slot.topicHint) || normalizeSlotText(slot.laneId),
			lyricTheme: normalizeSlotText(slot.lyricTheme) || lyricFocus || "",
		};
	}
	return {
		slot: slot.slot,
		transitionIntent: slot.transitionIntent ?? "",
		topicHint: slot.topicHint ?? "",
		captionFocus: slot.captionFocus ?? "",
		lyricTheme: slot.lyricTheme ?? "",
		energyTarget,
	};
}

function normalizeRecentSongs(
	songs?: ProviderTaskPorts["generateMetadata"]["recentSongs"],
) {
	if (!songs) return undefined;
	return songs.map((song) => ({
		title: song.title,
		artistName: song.artistName,
		genre: song.genre,
		subGenre: song.subGenre,
		vocalStyle: song.vocalStyle ?? undefined,
		mood: song.mood ?? undefined,
		energy: song.energy ?? undefined,
	}));
}

function normalizeStringList(value: OptionalStringList) {
	return value?.length ? value : undefined;
}

async function generateMetadataWithProvider(
	input: ProviderTaskPorts["generateMetadata"],
): Promise<SongMetadata> {
	const normalizedProvider = normalizeProvider(input.provider);
	return await generateSongMetadata({
		prompt: input.prompt,
		provider: normalizedProvider,
		model: input.model || "",
		lyricsLanguage: input.lyricsLanguage,
		managerBrief: input.managerBrief,
		managerSlot: normalizeManagerSlot(input.managerSlot),
		managerTransitionPolicy: input.managerTransitionPolicy,
		targetBpm: input.targetBpm,
		targetKey: input.targetKey,
		timeSignature: input.timeSignature,
		audioDuration: input.audioDuration,
		recentSongs: normalizeRecentSongs(input.recentSongs),
		recentDescriptions: input.recentDescriptions,
		isInterrupt: input.isInterrupt,
		promptDistance: input.promptDistance,
		promptProfile: input.promptProfile,
		promptMode: input.promptMode,
		signal: input.signal,
	});
}

async function generatePersonaWithProvider(
	input: ProviderTaskPorts["generatePersona"],
): Promise<string> {
	const normalizedProvider = normalizeProvider(input.provider);
	return await generatePersonaExtract({
		song: {
			title: input.song.title,
			artistName: input.song.artistName,
			genre: input.song.genre,
			subGenre: input.song.subGenre,
			mood: input.song.mood ?? undefined,
			energy: input.song.energy ?? undefined,
			era: input.song.era ?? undefined,
			vocalStyle: input.song.vocalStyle ?? undefined,
			instruments: normalizeStringList(input.song.instruments),
			themes: normalizeStringList(input.song.themes),
			description: input.song.description ?? undefined,
			lyrics: input.song.lyrics ?? undefined,
		},
		provider: normalizedProvider,
		model: input.model,
		signal: input.signal,
	});
}

async function generateCoverWithProvider(
	input: ProviderTaskPorts["generateCover"],
): Promise<unknown> {
	const normalizedProvider =
		input.provider === "ollama" ? "comfyui" : input.provider;
	const result = await generateCover({
		coverPrompt: input.coverPrompt,
		provider: normalizedProvider,
		model: input.model,
		signal: input.signal,
	});
	if (!result) {
		throw new Error("Cover generation returned no result");
	}
	return result;
}

async function submitAudioWithProvider(
	input: ProviderTaskPorts["submitAudio"],
): Promise<{ taskId: string }> {
	return await submitToAce({
		lyrics: input.lyrics,
		caption: input.caption,
		vocalStyle: input.vocalStyle,
		bpm: input.bpm,
		keyScale: input.keyScale,
		timeSignature: input.timeSignature,
		audioDuration: input.audioDuration,
		aceModel: input.aceModel,
		inferenceSteps: input.inferenceSteps,
		vocalLanguage: input.vocalLanguage,
		lmTemperature: input.lmTemperature,
		lmCfgScale: input.lmCfgScale,
		inferMethod: input.inferMethod,
		aceDcwEnabled: input.aceDcwEnabled,
		aceDcwMode: input.aceDcwMode,
		aceDcwScaler: input.aceDcwScaler,
		aceDcwHighScaler: input.aceDcwHighScaler,
		aceDcwWavelet: input.aceDcwWavelet,
		aceThinking: input.aceThinking,
		aceAutoDuration: input.aceAutoDuration,
		signal: input.signal,
	});
}

async function pollAudioWithProvider(
	input: ProviderTaskPorts["pollAudio"],
): Promise<{
	status: "running" | "succeeded" | "failed" | "not_found";
	audioPath?: string;
	error?: string;
}> {
	return await pollAce(input.taskId, input.signal);
}

async function batchPollAudioWithProvider(
	input: ProviderTaskPorts["batchPollAudio"],
): Promise<
	Map<
		string,
		{
			status: "running" | "succeeded" | "failed" | "not_found";
			audioPath?: string;
			error?: string;
		}
	>
> {
	const result = await batchPollAce(input.taskIds, input.signal);
	return result;
}

export function createProviderCapability(): ProviderCapability {
	return {
		generateMetadata: (input) => generateMetadataWithProvider(input),
		generatePersona: async (input) => {
			const persona = await generatePersonaWithProvider(input);
			return typeof persona === "string" ? persona : String(persona ?? "");
		},
		generateCover: async (input) => {
			const result = await generateCoverWithProvider(input);
			if (!result) {
				throw new Error("Cover generation returned no result");
			}
			return result;
		},
		submitAudio: async (input) => {
			const result = await submitAudioWithProvider(input);
			return result;
		},
		pollAudio: async (input) => {
			const result = await pollAudioWithProvider(input);
			if (!result) {
				throw new Error("Audio poll returned no result");
			}
			return result;
		},
		batchPollAudio: async (input) => {
			return await batchPollAudioWithProvider(input);
		},
	};
}

export class ProviderRegistry {
	private capability: ProviderCapability;
	private config: ProviderConfig | null = null;

	constructor() {
		this.capability = createProviderCapability();
	}

	refresh(config: ProviderConfig): void {
		this.config = config;
		logger.debug({ providerConfig: config }, "Provider registry refreshed");
	}

	get textCapability() {
		return this.capability;
	}

	get imageCapability() {
		return this.capability;
	}

	get audioCapability() {
		return this.capability;
	}

	get currentConfig(): ProviderConfig | null {
		return this.config;
	}
}
