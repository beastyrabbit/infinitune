import { Hono } from "hono";
import { z } from "zod";
import {
	getInventoryStats,
	getRadioAnalytics,
	listRadioAlbums,
	topUpInventory,
} from "../services/album-generation-service";
import {
	addCoverSource,
	deleteCoverSource,
	getNasStatus,
	getRadioSourceSettings,
	listCoverSources,
} from "../services/cover-source-service";
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

// HTTP play/pause are a no-WebSocket fallback (the client only uses them when
// its socket send fails). They deactivate by listener id directly and do not
// participate in the WS per-socket refcount — acceptable because a client
// without a live socket has no socket to count.
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

const AddSourceSchema = z.object({
	url: z.string().url().max(500),
	genreTag: z.string().max(100).optional(),
});

app.get("/sources", async (c) => {
	const settings = await getRadioSourceSettings();
	return c.json({
		sources: await listCoverSources(),
		nas: getNasStatus(settings.sourceLibraryDir),
	});
});

app.post("/sources", async (c) => {
	const result = AddSourceSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	const parsed = new URL(result.data.url);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return c.json({ error: "Only http(s) URLs are supported" }, 400);
	}
	return c.json(await addCoverSource(result.data.url, result.data.genreTag));
});

app.delete("/sources/:id", async (c) => {
	const deleted = await deleteCoverSource(c.req.param("id"));
	if (!deleted) return c.json({ error: "Source not found" }, 404);
	return c.json({ ok: true });
});

export default app;
