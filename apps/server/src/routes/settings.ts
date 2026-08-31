import { SetSettingSchema } from "@infinitune/shared/validation/playlist-schemas";
import { Hono } from "hono";
import { requireUserActor } from "../auth/actor";
import * as settingsService from "../services/settings-service";

const app = new Hono();

const ACE_STEP_ENV_LOCK_KEY = "aceStepUrlManagedByEnvironment";

function environmentAceStepUrl(): string {
	return process.env.ACE_STEP_URL?.trim() || "";
}

// GET /api/settings
app.get("/", async (c) => {
	const values = await settingsService.getAll();
	const aceStepUrl = environmentAceStepUrl();
	return c.json({
		...values,
		...(aceStepUrl ? { aceStepUrl } : {}),
		[ACE_STEP_ENV_LOCK_KEY]: String(Boolean(aceStepUrl)),
	});
});

// GET /api/settings/:key
app.get("/:key", async (c) => {
	const key = c.req.param("key");
	const aceStepUrl = environmentAceStepUrl();
	if (key === ACE_STEP_ENV_LOCK_KEY) {
		return c.json(String(Boolean(aceStepUrl)));
	}
	if (key === "aceStepUrl" && aceStepUrl) return c.json(aceStepUrl);
	return c.json(await settingsService.get(key));
});

// POST /api/settings
app.post("/", async (c) => {
	if (process.env.NODE_ENV === "production" && !(await requireUserActor(c))) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const body = await c.req.json();
	const result = SetSettingSchema.safeParse(body);
	if (!result.success) {
		return c.json({ error: result.error.message }, 400);
	}
	if (settingsService.isSensitiveSettingKey(result.data.key)) {
		return c.json(
			{ error: "Use the dedicated credential endpoint for this setting" },
			400,
		);
	}
	await settingsService.set(result.data.key, result.data.value);
	return c.json({ ok: true });
});

export default app;
