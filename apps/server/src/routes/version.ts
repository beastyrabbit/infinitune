import { Hono } from "hono";

const app = new Hono();

// Polled by the release workflow to confirm a rollout; never cache it.
app.get("/", (c) => {
	c.header("Cache-Control", "no-store");
	return c.json({ release: process.env.INFINITUNE_RELEASE || "dev" });
});

export default app;
