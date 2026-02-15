import { SetSettingSchema } from "@infinitune/shared/validation/playlist-schemas";
import { Hono } from "hono";
import * as settingsService from "../services/settings-service";

const app = new Hono();

// GET /api/settings
app.get("/", async (c) => {
	return c.json(await settingsService.getAll());
});

// GET /api/settings/:key
app.get("/:key", async (c) => {
	return c.json(await settingsService.get(c.req.param("key")));
});

// POST /api/settings
app.post("/", async (c) => {
	const body = await c.req.json();
	const result = SetSettingSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	await settingsService.set(result.data.key, result.data.value);
	return c.json({ ok: true });
});

export default app;
