import { type Context, Hono } from "hono";
import { z } from "zod";
import { getRequestActor } from "../auth/actor";
import { shareLinkLimiter, shareReadLimiter } from "../middleware/limiters";
import {
	createShareLink,
	getShareLinkById,
	getShareResource,
	isShareResourceType,
	listShareLinksForResource,
	resolveShareLink,
	revokeShareLink,
	ShareLinkLimitError,
	type ShareResourceType,
} from "../services/share-link-service";

const app = new Hono();

const CreateSchema = z.object({
	resourceType: z.enum(["playlist", "song"]),
	resourceId: z.string().min(1),
	expiresInDays: z.number().int().min(1).max(365).optional(),
});

async function canManageResource(
	c: Context,
	resourceType: ShareResourceType,
	resourceId: string,
): Promise<boolean> {
	const resource = await getShareResource(resourceType, resourceId);
	if (!resource) return false;
	if (!resource.ownerUserId) return true;
	const actor = await getRequestActor(c);
	return actor.kind === "user" && actor.userId === resource.ownerUserId;
}

// POST /api/share — create a share link
app.post("/", shareLinkLimiter, async (c) => {
	const result = CreateSchema.safeParse(await c.req.json());
	if (!result.success) return c.json({ error: result.error.message }, 400);
	if (
		!(await canManageResource(
			c,
			result.data.resourceType,
			result.data.resourceId,
		))
	) {
		return c.json({ error: "Resource not found" }, 404);
	}
	let link: Awaited<ReturnType<typeof createShareLink>>;
	try {
		link = await createShareLink(result.data);
	} catch (error) {
		if (error instanceof ShareLinkLimitError) {
			return c.json({ error: error.message }, 409);
		}
		throw error;
	}
	if (!link) return c.json({ error: "Resource not found" }, 404);
	return c.json(link, 201);
});

// GET /api/share?resourceType=playlist&resourceId=... — list links for a resource
app.get("/", shareLinkLimiter, async (c) => {
	const resourceType = c.req.query("resourceType") ?? "";
	const resourceId = c.req.query("resourceId") ?? "";
	if (!isShareResourceType(resourceType) || !resourceId) {
		return c.json({ error: "resourceType and resourceId are required" }, 400);
	}
	if (!(await canManageResource(c, resourceType, resourceId))) {
		return c.json({ error: "Resource not found" }, 404);
	}
	return c.json({
		links: await listShareLinksForResource(resourceType, resourceId),
	});
});

// GET /api/share/:token — resolve into a read-only public snapshot
app.get("/:token", shareReadLimiter, async (c) => {
	const resolved = await resolveShareLink(c.req.param("token"));
	if (!resolved) return c.json({ error: "Share link not found" }, 404);
	return c.json(resolved);
});

// DELETE /api/share/:id — revoke a link
app.delete("/:id", shareLinkLimiter, async (c) => {
	const id = c.req.param("id");
	const link = await getShareLinkById(id);
	if (
		!link ||
		!(await canManageResource(c, link.resourceType, link.resourceId))
	) {
		return c.json({ error: "Share link not found" }, 404);
	}
	const revoked = await revokeShareLink(id);
	if (!revoked) return c.json({ error: "Share link not found" }, 404);
	return c.json({ ok: true });
});

export default app;
