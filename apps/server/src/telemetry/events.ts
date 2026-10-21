import { telemetryConfig } from "@infinitune/shared/telemetry";
import { captureError } from "@infinitune/shared/telemetry-node";
import { on } from "../events/event-bus";
import * as playlistService from "../services/playlist-service";
import * as settingsService from "../services/settings-service";
import * as songService from "../services/song-service";
import { trackServerEvent } from "./umami";

export function startTelemetryEvents(): void {
	const config = telemetryConfig(process.env);
	if (!config.enabled || (!config.dsn && !config.umamiWebsiteId)) return;
	on("playlist.created", ({ playlistId }) =>
		trackServerEvent("playlist_created", { playlist_id: playlistId }),
	);
	on("playlist.steered", ({ playlistId, newEpoch }) =>
		trackServerEvent("playlist_steered", {
			playlist_id: playlistId,
			epoch: newEpoch,
		}),
	);
	on("song.status_changed", async ({ songId, playlistId, from, to }) => {
		const started = to === "generating_metadata" && from === "pending";
		const completed = to === "ready" && from === "saving";
		const failed = to === "error" || to === "retry_pending";
		if (!started && !completed && !failed) return;
		const song = await songService.getById(songId);
		if (!song) return;
		const playlist = await playlistService.getById(playlistId);
		const stage = started ? to : song.erroredAtStatus || from;
		const audio = ["submitting_to_ace", "generating_audio", "saving"].includes(
			stage,
		);
		const provider = audio
			? "ace-step"
			: song.llmProvider || playlist?.llmProvider || "unknown";
		const model = audio
			? playlist?.aceModel ||
				(await settingsService.get("aceModel")) ||
				"default"
			: song.llmModel || playlist?.llmModel || "unknown";
		trackServerEvent(
			started
				? "song_generation_started"
				: completed
					? "song_generation_completed"
					: "song_generation_failed",
			{
				song_id: songId,
				playlist_id: playlistId,
				provider,
				model,
				stage,
				duration_ms: Math.max(
					0,
					Date.now() - (song.generationStartedAt || song.createdAt),
				),
				...(failed ? { error_class: "PipelineError", status: to } : {}),
			},
		);
		if (failed) {
			const error = new Error("Song pipeline failed");
			error.name = "PipelineError";
			captureError(error, {
				songId,
				playlistId,
				stage,
				provider,
				model,
				status: to,
			});
		}
	});
}
