import { Hono } from "hono";
import { z } from "zod";
import {
	getInventoryStats,
	getRadioAnalytics,
	listRadioAlbums,
	topUpInventory,
} from "../services/album-generation-service";
import {
	listRadioRequests,
	submitRadioRequest,
} from "../services/radio-request-service";
import {
	activateListener,
	addFeedback,
	deactivateListener,
	getStationSnapshot,
	heartbeatListener,
	seekStation,
	skipStation,
} from "../services/radio-station-service";
import * as songService from "../services/song-service";

const app = new Hono();

const ListenerSchema = z.object({
	listenerId: z.string().min(1),
});

const SeekSchema = ListenerSchema.extend({
	offsetSeconds: z.number().min(0),
});

const FeedbackSchema = z.object({
	songId: z.string().min(1),
	kind: z.enum(["like", "dislike"]),
});

const RequestSchema = z.object({
	prompt: z.string().min(1).max(2000),
});

app.get("/state", (c) => c.json(getStationSnapshot()));

app.get("/queue", async (c) => {
	return c.json({
		...getStationSnapshot(),
		stats: getInventoryStats(),
		analytics: getRadioAnalytics(),
		requests: listRadioRequests(),
	});
});

app.get("/library", async (c) => {
	const allSongs = await songService.listAll(1000);
	return c.json({
		albums: await listRadioAlbums(),
		legacySongs: allSongs.filter(
			(song) => !song.radioEligible || !song.albumId,
		),
	});
});

app.post("/play", async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(await activateListener(result.data.listenerId));
});

app.post("/pause", async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(deactivateListener(result.data.listenerId));
});

app.post("/heartbeat", async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json({ ok: true, state: getStationSnapshot() });
});

app.post("/seek", async (c) => {
	const result = SeekSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json(seekStation(result.data.offsetSeconds));
});

app.post("/skip", async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json(await skipStation());
});

app.post("/feedback", async (c) => {
	const result = FeedbackSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(await addFeedback(result.data.songId, result.data.kind));
});

app.post("/requests", async (c) => {
	const result = RequestSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(await submitRadioRequest(result.data.prompt));
});

app.post("/force-generate-album", async (c) => {
	return c.json(await topUpInventory({ force: true }));
});

export default app;
