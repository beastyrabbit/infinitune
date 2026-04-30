import { logger } from "../logger";
import { getServiceUrls } from "./service-urls";

async function assertOk(response: Response, label: string): Promise<void> {
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`${label} failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
		);
	}
}

export interface AceSubmitResult {
	taskId: string;
}

export interface AcePollResult {
	status: "running" | "succeeded" | "failed" | "not_found";
	audioPath?: string;
	error?: string;
	result?: unknown;
	timeCosts?: Record<string, number>;
}

/** Raw task shape returned by the ACE-Step /query_result endpoint */
interface AceRawTask {
	task_id: string;
	status: number;
	result?: string;
	extra_outputs?: Record<string, unknown>;
}

function extractTimeCosts(
	task: AceRawTask,
): Record<string, number> | undefined {
	const raw = task.extra_outputs?.time_costs;
	if (!raw || typeof raw !== "object") return undefined;
	const costs: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === "number") costs[key] = value;
	}
	return Object.keys(costs).length > 0 ? costs : undefined;
}

function captionAlreadyDescribesVocals(caption: string): boolean {
	return /\b(vocal|vocals|voice|voices|singer|sung|lead|duet|choir|harmony|harmonies|ad-?lib|chant|spoken|rap|hook lines|background vocals)\b/i.test(
		caption,
	);
}

function captionRequestsNoVocals(caption: string, lyrics: string): boolean {
	return (
		/\b(instrumental|no vocals|wordless)\b/i.test(caption) ||
		/^\s*\[Instrumental\]\s*$/i.test(lyrics)
	);
}

function buildAcePrompt(options: {
	caption: string;
	lyrics: string;
	vocalStyle?: string;
}): string {
	const caption = options.caption.trim();
	const vocalStyle = options.vocalStyle?.trim();
	if (
		!vocalStyle ||
		captionRequestsNoVocals(caption, options.lyrics) ||
		captionAlreadyDescribesVocals(caption)
	) {
		return caption;
	}
	return `${caption}, ${vocalStyle}`;
}

export async function submitToAce(options: {
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
	aceThinking?: boolean;
	aceAutoDuration?: boolean;
	signal?: AbortSignal;
}): Promise<AceSubmitResult> {
	const {
		lyrics,
		caption,
		vocalStyle,
		bpm,
		keyScale,
		timeSignature,
		audioDuration,
		aceModel,
		inferenceSteps,
		vocalLanguage,
		lmTemperature,
		lmCfgScale,
		inferMethod,
		aceThinking,
		aceAutoDuration,
		signal,
	} = options;

	const urls = await getServiceUrls();
	const aceUrl = urls.aceStepUrl;

	const fullPrompt = buildAcePrompt({ caption, lyrics, vocalStyle });

	const thinking = aceThinking ?? false;
	// -1 signals ACE-Step to auto-detect duration from lyrics
	const effectiveDuration = (aceAutoDuration ?? true) ? -1 : audioDuration;

	const payload: Record<string, unknown> = {
		prompt: fullPrompt,
		lyrics,
		bpm,
		key_scale: keyScale,
		time_signature: timeSignature,
		audio_duration: effectiveDuration,
		thinking,
		batch_size: 1,
		inference_steps: inferenceSteps ?? 8,
		vocal_language: vocalLanguage || "en",
		use_format: thinking,
		use_cot_caption: thinking,
		use_cot_metas: thinking,
		use_cot_language: thinking,
		constrained_decoding: true,
		lm_temperature: lmTemperature ?? 0.85,
		lm_cfg_scale: lmCfgScale ?? 2.5,
		infer_method: inferMethod || "ode",
		shift: 3.0,
		audio_format: "mp3",
	};

	const normalizedAceModel = aceModel?.trim();
	if (normalizedAceModel && normalizedAceModel !== "__default__") {
		payload.model = normalizedAceModel;
	}

	const response = await fetch(`${aceUrl}/release_task`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
		signal,
	});

	await assertOk(response, "ACE-Step submit");

	const data = (await response.json()) as {
		data?: { task_id?: string };
		error?: string;
	};
	const taskId = data.data?.task_id;
	if (!taskId) {
		throw new Error(data.error || "No task_id returned from ACE-Step");
	}

	return { taskId };
}

export async function batchPollAce(
	taskIds: string[],
	signal?: AbortSignal,
): Promise<Map<string, AcePollResult>> {
	const urls = await getServiceUrls();
	const aceUrl = urls.aceStepUrl;

	const response = await fetch(`${aceUrl}/query_result`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ task_id_list: taskIds }),
		signal,
	});

	await assertOk(response, "ACE-Step batch poll");

	const data = (await response.json()) as { data?: AceRawTask[] };
	const results = data.data;
	const resultMap = new Map<string, AcePollResult>();

	if (!results || !Array.isArray(results)) {
		for (const id of taskIds) {
			resultMap.set(id, { status: "not_found" });
		}
		return resultMap;
	}

	// Index ACE results by task_id
	const aceById = new Map<string, AceRawTask>();
	for (const task of results) {
		if (task.task_id) {
			aceById.set(task.task_id, task);
		}
	}

	for (const id of taskIds) {
		const task = aceById.get(id);
		if (!task) {
			resultMap.set(id, { status: "not_found" });
			continue;
		}

		if (task.status === 0) {
			resultMap.set(id, { status: "running" });
		} else if (task.status === 2) {
			resultMap.set(id, { status: "failed", error: "Audio generation failed" });
		} else if (task.status === 1) {
			let resultItems: { file: string }[];
			try {
				resultItems = JSON.parse(task.result ?? "[]");
			} catch {
				resultMap.set(id, {
					status: "failed",
					error: "Failed to parse result JSON",
				});
				continue;
			}
			if (resultItems.length > 0) {
				const timeCosts = extractTimeCosts(task);
				if (timeCosts) {
					logger.info({ taskId: id, timeCosts }, "ACE time_costs breakdown");
				}
				resultMap.set(id, {
					status: "succeeded",
					audioPath: resultItems[0].file,
					result: resultItems[0],
					timeCosts,
				});
			} else {
				resultMap.set(id, {
					status: "failed",
					error: "No audio files in result",
				});
			}
		} else {
			resultMap.set(id, { status: "running" });
		}
	}

	return resultMap;
}

export async function pollAce(
	taskId: string,
	signal?: AbortSignal,
): Promise<AcePollResult> {
	const urls = await getServiceUrls();
	const aceUrl = urls.aceStepUrl;

	const response = await fetch(`${aceUrl}/query_result`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ task_id_list: [taskId] }),
		signal,
	});

	await assertOk(response, "ACE-Step poll");

	const data = (await response.json()) as { data?: AceRawTask[] };
	const results = data.data;
	if (!results || !Array.isArray(results) || results.length === 0) {
		return { status: "not_found" };
	}

	const task = results[0];

	if (task.status === 0) {
		return { status: "running" };
	}

	if (task.status === 2) {
		return { status: "failed", error: "Audio generation failed" };
	}

	if (task.status === 1) {
		let resultItems: { file: string }[] = [];
		try {
			resultItems = JSON.parse(task.result ?? "[]");
		} catch {
			throw new Error("Failed to parse ACE-Step result JSON");
		}

		if (resultItems.length === 0) {
			throw new Error("No audio files in ACE-Step result");
		}

		const firstResult = resultItems[0];
		const timeCosts = extractTimeCosts(task);
		if (timeCosts) {
			logger.info({ taskId, timeCosts }, "ACE time_costs breakdown");
		}
		return {
			status: "succeeded",
			audioPath: firstResult.file,
			result: firstResult,
			timeCosts,
		};
	}

	return { status: "running" };
}
