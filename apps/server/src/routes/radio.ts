import { normalizeLlmProvider } from "@infinitune/shared/text-llm-profile";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { requireUserActor } from "../auth/actor";
import {
	generationLimiter,
	radioControlLimiter,
	radioFeedbackLimiter,
	radioRequestLimiter,
	radioSourceMutationLimiter,
	stationPresetLimiter,
} from "../middleware/limiters";
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
import * as presetService from "../services/radio-station-presets-service";
import {
	activateListener,
	addFeedback,
	deactivateListener,
	getStationSnapshot,
	heartbeatListener,
	seekStation,
	skipStation,
} from "../services/radio-station-service";
import * as settingsService from "../services/settings-service";
import * as songService from "../services/song-service";
import { songReadAccess } from "./songs/access";

const app = new Hono();

const requireProductionUser: MiddlewareHandler = async (c, next) => {
	if (process.env.NODE_ENV === "production" && !(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};

const requireOpenRouterProductionUser: MiddlewareHandler = async (c, next) => {
	if (process.env.NODE_ENV === "production") {
		const settings = await settingsService.getAll();
		if (
			normalizeLlmProvider(settings.textProvider) === "openrouter" &&
			!(await requireUserActor(c))
		) {
			return c.json(
				{
					error: "Authentication is required to use the server OpenRouter key",
				},
				401,
			);
		}
	}
	await next();
};

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
	const limitParam = Number(c.req.query("limit"));
	const limit =
		Number.isFinite(limitParam) && limitParam > 0
			? Math.min(Math.floor(limitParam), 1000)
			: 300;
	return c.json({
		albums: await listRadioAlbums(),
		legacySongs: await songService.listLegacy(limit, await songReadAccess(c)),
	});
});

app.post("/play", requireProductionUser, radioControlLimiter, async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(await activateListener(result.data.listenerId));
});

// REST owns authenticated listener activation and deactivation in production;
// WebSockets carry state updates and heartbeats.
app.post("/pause", requireProductionUser, radioControlLimiter, async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json(deactivateListener(result.data.listenerId));
});

app.post("/heartbeat", radioControlLimiter, async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json({ ok: true, state: getStationSnapshot() });
});

app.post("/seek", requireProductionUser, radioControlLimiter, async (c) => {
	const result = SeekSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json(seekStation(result.data.offsetSeconds));
});

app.post("/skip", requireProductionUser, radioControlLimiter, async (c) => {
	const result = ListenerSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	heartbeatListener(result.data.listenerId);
	return c.json(await skipStation());
});

app.post(
	"/feedback",
	requireProductionUser,
	radioFeedbackLimiter,
	async (c) => {
		const result = FeedbackSchema.safeParse(await c.req.json());
		if (!result.success) return c.json({ error: result.error.message }, 400);
		const snapshot = await addFeedback(result.data.songId, result.data.kind);
		if (!snapshot) return c.json({ error: "Radio song not found" }, 404);
		return c.json(snapshot);
	},
);

app.post(
	"/requests",
	requireOpenRouterProductionUser,
	radioRequestLimiter,
	async (c) => {
		const result = RequestSchema.safeParse(await c.req.json());
		if (!result.success) return c.json({ error: result.error.message }, 400);
		return c.json(await submitRadioRequest(result.data.prompt));
	},
);

// ─── Station presets (text-only station intents, one active at a time) ──

const PresetSchema = z.object({
	name: z.string().trim().min(1).max(80),
	description: z.string().trim().max(500).nullish(),
	genrePrompt: z.string().trim().min(1).max(500),
	vocalStyle: z.string().trim().max(300).nullish(),
});

const PresetUpdateSchema = PresetSchema.partial();

app.get("/presets", (c) => c.json({ presets: presetService.listPresets() }));

app.post("/presets", stationPresetLimiter, async (c) => {
	if (!(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const result = PresetSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	try {
		return c.json(await presetService.createPreset(result.data), 201);
	} catch (error) {
		if (error instanceof presetService.StationPresetLimitError) {
			return c.json({ error: error.message }, 409);
		}
		throw error;
	}
});

app.patch("/presets/:id", stationPresetLimiter, async (c) => {
	if (!(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const result = PresetUpdateSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	const preset = await presetService.updatePreset(
		c.req.param("id"),
		result.data,
	);
	if (!preset) return c.json({ error: "Preset not found" }, 404);
	return c.json(preset);
});

app.post("/presets/:id/activate", stationPresetLimiter, async (c) => {
	if (!(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const preset = await presetService.activatePreset(c.req.param("id"));
	if (!preset) return c.json({ error: "Preset not found" }, 404);
	return c.json(preset);
});

app.delete("/presets/:id", stationPresetLimiter, async (c) => {
	if (!(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const deleted = await presetService.deletePreset(c.req.param("id"));
	if (!deleted) return c.json({ error: "Preset not found" }, 404);
	return c.json({ ok: true });
});

app.post(
	"/force-generate-album",
	requireProductionUser,
	generationLimiter,
	async (c) => {
		return c.json(await topUpInventory({ force: true }));
	},
);

const AddSourceSchema = z.object({
	url: z.string().url().max(500),
	genreTag: z.string().max(100).optional(),
});

app.get("/sources", requireProductionUser, async (c) => {
	const settings = await getRadioSourceSettings();
	return c.json({
		sources: await listCoverSources(),
		nas: getNasStatus(settings.sourceLibraryDir),
	});
});

app.post(
	"/sources",
	requireProductionUser,
	radioSourceMutationLimiter,
	async (c) => {
		const result = AddSourceSchema.safeParse(await c.req.json());
		if (!result.success) return c.json({ error: result.error.message }, 400);
		const parsed = new URL(result.data.url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return c.json({ error: "Only http(s) URLs are supported" }, 400);
		}
		return c.json(await addCoverSource(result.data.url, result.data.genreTag));
	},
);

app.delete(
	"/sources/:id",
	requireProductionUser,
	radioSourceMutationLimiter,
	async (c) => {
		const deleted = await deleteCoverSource(c.req.param("id"));
		if (!deleted) return c.json({ error: "Source not found" }, 404);
		return c.json({ ok: true });
	},
);

export default app;
