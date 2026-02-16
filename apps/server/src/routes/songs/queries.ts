import * as fs from "node:fs";
import * as path from "node:path";
import { BatchSongIdsSchema } from "@infinitune/shared/validation/song-schemas";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { logger } from "../../logger";
import * as songService from "../../services/song-service";
import { songToWire } from "../../wire";

const app = new Hono();

// GET /api/songs — list all songs (with metadata), newest first
app.get("/", async (c) => {
	return c.json(await songService.listAll());
});

// GET /api/songs/by-playlist/:playlistId
app.get("/by-playlist/:playlistId", async (c) => {
	return c.json(await songService.listByPlaylist(c.req.param("playlistId")));
});

// GET /api/songs/queue/:playlistId — alias for by-playlist
app.get("/queue/:playlistId", async (c) => {
	return c.json(await songService.listByPlaylist(c.req.param("playlistId")));
});

// GET /api/songs/next-order-index/:playlistId
app.get("/next-order-index/:playlistId", async (c) => {
	return c.json(await songService.getNextOrderIndex(c.req.param("playlistId")));
});

// GET /api/songs/in-audio-pipeline
app.get("/in-audio-pipeline", async (c) => {
	return c.json(await songService.getInAudioPipeline());
});

// GET /api/songs/needs-persona
app.get("/needs-persona", async (c) => {
	return c.json(await songService.getNeedsPersona());
});

// GET /api/songs/work-queue/:playlistId
app.get("/work-queue/:playlistId", async (c) => {
	return c.json(await songService.getWorkQueue(c.req.param("playlistId")));
});

// POST /api/songs/batch — get songs by IDs
app.post("/batch", async (c) => {
	const body = await c.req.json();
	const result = BatchSongIdsSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	return c.json(await songService.getByIds(result.data.ids));
});

// GET /api/songs/:id/audio — stream audio from NFS
app.get("/:id/audio", async (c) => {
	const song = await songService.getById(c.req.param("id"));
	if (!song?.storagePath) return c.json({ error: "Song not found" }, 404);

	// Resolve the audio file on the local filesystem.
	// DB may have old dev paths like /mnt/truenas/MediaBiB/media/AI-Music/...
	// Pod NFS mount: /music = MediaBiB root. ACE_NAS_PREFIX = old dev mount point.
	let songDir = song.storagePath;
	let audioFile = path.join(songDir, "audio.mp3");

	if (!fs.existsSync(audioFile)) {
		// Remap old dev paths: replace ACE_NAS_PREFIX with NFS mount root
		const nasPrefix = process.env.ACE_NAS_PREFIX;
		const nfsMount = process.env.NFS_MOUNT_PATH || "/music";
		if (nasPrefix && songDir.startsWith(nasPrefix)) {
			songDir = nfsMount + songDir.slice(nasPrefix.length);
			audioFile = path.join(songDir, "audio.mp3");
		}
	}

	if (!fs.existsSync(audioFile)) {
		logger.warn({ songId: song.id, audioFile }, "Audio file not found on NFS");
		return c.json({ error: "Audio file not found" }, 404);
	}

	const stat = fs.statSync(audioFile);
	const range = c.req.header("Range");

	if (range) {
		const match = range.match(/bytes=(\d+)-(\d*)/);
		if (match) {
			const start = Number.parseInt(match[1], 10);
			const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
			c.header("Content-Type", "audio/mpeg");
			c.header("Accept-Ranges", "bytes");
			c.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
			c.header("Content-Length", String(end - start + 1));
			c.status(206);
			return stream(c, async (s) => {
				const rs = fs.createReadStream(audioFile, { start, end });
				for await (const chunk of rs) {
					await s.write(chunk as Uint8Array);
				}
			});
		}
	}

	c.header("Content-Type", "audio/mpeg");
	c.header("Content-Length", String(stat.size));
	c.header("Accept-Ranges", "bytes");
	return stream(c, async (s) => {
		const rs = fs.createReadStream(audioFile);
		for await (const chunk of rs) {
			await s.write(chunk as Uint8Array);
		}
	});
});

// GET /api/songs/:id
app.get("/:id", async (c) => {
	const song = await songService.getById(c.req.param("id"));
	if (!song) return c.json(null, 404);
	return c.json(songToWire(song));
});

export default app;
