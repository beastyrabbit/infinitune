import type { WorkerStatus } from "@/hooks/useWorkerStatus";
import type { Song } from "@/types";

export interface PipelineTruth {
	lyricsInProgress: number;
	lyricsInQueue: number;
	lyricsPreQueue: number;
	personaLlmJobs: number;
	audioInProgress: number;
	audioInQueue: number;
	audioPreQueue: number;
	readyCount: number;
	playedCount: number;
	errorCount: number;
	retryPendingCount: number;
}

function collectQueueSongIds(status: WorkerStatus | null) {
	const llm = new Set<string>();
	const audio = new Set<string>();

	if (!status) return { llm, audio };

	for (const item of status.queues.llm.activeItems) llm.add(item.songId);
	for (const item of status.queues.llm.pendingItems) llm.add(item.songId);
	for (const item of status.queues.audio.activeItems) audio.add(item.songId);
	for (const item of status.queues.audio.pendingItems) audio.add(item.songId);

	return { llm, audio };
}

export function computePipelineTruth(
	songs: Song[] | undefined,
	status: WorkerStatus | null,
): PipelineTruth {
	const safeSongs = songs ?? [];
	const { llm: llmQueueSongIds, audio: audioQueueSongIds } =
		collectQueueSongIds(status);

	let lyricsInProgress = 0;
	let lyricsInQueue = 0;
	let audioInProgress = 0;
	let audioInQueue = 0;
	let readyCount = 0;
	let playedCount = 0;
	let errorCount = 0;
	let retryPendingCount = 0;

	for (const song of safeSongs) {
		switch (song.status) {
			case "generating_metadata":
				lyricsInProgress += 1;
				if (llmQueueSongIds.has(song.id)) lyricsInQueue += 1;
				break;
			case "submitting_to_ace":
			case "generating_audio":
			case "saving":
				audioInProgress += 1;
				if (audioQueueSongIds.has(song.id)) audioInQueue += 1;
				break;
			case "ready":
				readyCount += 1;
				break;
			case "played":
				playedCount += 1;
				break;
			case "error":
				errorCount += 1;
				break;
			case "retry_pending":
				retryPendingCount += 1;
				break;
			default:
				break;
		}
	}

	let personaLlmJobs = 0;
	if (status) {
		for (const item of status.queues.llm.activeItems) {
			if (item.priority >= 20_000) personaLlmJobs += 1;
		}
		for (const item of status.queues.llm.pendingItems) {
			if (item.priority >= 20_000) personaLlmJobs += 1;
		}
	}

	return {
		lyricsInProgress,
		lyricsInQueue,
		lyricsPreQueue: Math.max(0, lyricsInProgress - lyricsInQueue),
		personaLlmJobs,
		audioInProgress,
		audioInQueue,
		audioPreQueue: Math.max(0, audioInProgress - audioInQueue),
		readyCount,
		playedCount,
		errorCount,
		retryPendingCount,
	};
}
