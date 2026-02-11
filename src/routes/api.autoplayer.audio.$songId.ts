import * as fs from "node:fs";
import * as path from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { getServiceUrls } from "@/lib/server-settings";

export const Route = createFileRoute("/api/autoplayer/audio/$songId")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				try {
					const { songId } = params;
					const urls = await getServiceUrls();
					const aceUrl = urls.aceStepUrl;
					const storagePath =
						process.env.MUSIC_STORAGE_PATH ||
						"/mnt/truenas/MediaBiB/media/AI-Music";

					// Check query params for aceAudioPath (used when proxying from ACE-Step)
					const url = new URL(request.url);
					const aceAudioPath = url.searchParams.get("aceAudioPath");

					// Try to find the song's NFS path first
					// The songId could be a Convex ID — look for matching folder via songId marker file
					const songDir = path.join(storagePath, ".by-id", songId);
					const audioFile = path.join(songDir, "audio.mp3");

					if (fs.existsSync(audioFile)) {
						const stat = fs.statSync(audioFile);
						const range = request.headers.get("range");

						if (range) {
							const parts = range.replace(/bytes=/, "").split("-");
							const start = parseInt(parts[0], 10);
							const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
							const chunkSize = end - start + 1;

							const stream = fs.createReadStream(audioFile, { start, end });
							const readable = new ReadableStream({
								start(controller) {
									stream.on("data", (chunk) => controller.enqueue(chunk));
									stream.on("end", () => controller.close());
									stream.on("error", (err) => controller.error(err));
								},
							});

							return new Response(readable, {
								status: 206,
								headers: {
									"Content-Type": "audio/mpeg",
									"Content-Range": `bytes ${start}-${end}/${stat.size}`,
									"Content-Length": String(chunkSize),
									"Accept-Ranges": "bytes",
									"Cache-Control": "public, max-age=31536000",
								},
							});
						}

						const buffer = fs.readFileSync(audioFile);
						return new Response(buffer, {
							headers: {
								"Content-Type": "audio/mpeg",
								"Content-Length": String(stat.size),
								"Accept-Ranges": "bytes",
								"Cache-Control": "public, max-age=31536000",
							},
						});
					}

					// Fall back to proxying from ACE-Step using aceAudioPath
					if (aceAudioPath) {
						const proxyUrl = `${aceUrl}${aceAudioPath}`;
						const response = await fetch(proxyUrl);

						if (!response.ok) {
							return new Response(
								JSON.stringify({ error: "Audio not found on ACE-Step server" }),
								{
									status: response.status,
									headers: { "Content-Type": "application/json" },
								},
							);
						}

						const audioBuffer = await response.arrayBuffer();
						const contentType =
							response.headers.get("content-type") || "audio/mpeg";

						return new Response(audioBuffer, {
							headers: {
								"Content-Type": contentType,
								"Cache-Control": "public, max-age=3600",
								"Accept-Ranges": "bytes",
							},
						});
					}

					return new Response(
						JSON.stringify({
							error:
								"Audio not found. No NFS file and no aceAudioPath provided.",
						}),
						{ status: 404, headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
					return new Response(
						JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Failed to fetch audio",
						}),
						{ status: 500, headers: { "Content-Type": "application/json" } },
					);
				}
			},
		},
	},
});
