import { Hono } from "hono";
import z from "zod";
import {
	deleteMemory,
	getMemory,
	type MemoryKind,
	type MemoryPatch,
	type MemoryScope,
	searchMemory,
	updateMemory,
	writeMemory,
} from "../agents/memory-store";

const app = new Hono();

const MemoryScopeSchema = z.enum(["global", "playlist"]);
const MemoryKindSchema = z.enum([
	"taste",
	"avoid",
	"topic",
	"constraint",
	"production",
	"lyrics",
	"summary",
	"feedback",
]);

const WriteMemorySchema = z.object({
	scope: MemoryScopeSchema,
	playlistId: z.string().nullable().optional(),
	kind: MemoryKindSchema,
	title: z.string().min(1),
	content: z.unknown(),
	confidence: z.number().min(0).max(1),
	importance: z.number().min(0).max(1),
	expiresAt: z.number().nullable().optional(),
});

const PatchMemorySchema = z.object({
	scope: MemoryScopeSchema.optional(),
	playlistId: z.string().nullable().optional(),
	kind: MemoryKindSchema.optional(),
	title: z.string().min(1).optional(),
	content: z.unknown().optional(),
	confidence: z.number().min(0).max(1).optional(),
	importance: z.number().min(0).max(1).optional(),
	expiresAt: z.number().nullable().optional(),
});

function parseLimit(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

app.get("/", async (c) => {
	const scope = MemoryScopeSchema.safeParse(c.req.query("scope"));
	const kind = MemoryKindSchema.safeParse(c.req.query("kind"));
	const entries = await searchMemory({
		scope: scope.success ? (scope.data as MemoryScope) : undefined,
		playlistId: c.req.query("playlistId"),
		query: c.req.query("query"),
		kind: kind.success ? (kind.data as MemoryKind) : undefined,
		limit: parseLimit(c.req.query("limit")),
	});
	return c.json({ entries });
});

app.get("/:id", async (c) => {
	const entry = await getMemory(c.req.param("id"));
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	return c.json({ entry });
});

app.post("/", async (c) => {
	const body = await c.req.json();
	const result = WriteMemorySchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	return c.json({ entry: await writeMemory(result.data) });
});

app.patch("/:id", async (c) => {
	const body = await c.req.json();
	const result = PatchMemorySchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	const entry = await updateMemory(
		c.req.param("id"),
		result.data as MemoryPatch,
	);
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	return c.json({ entry });
});

app.delete("/:id", async (c) => {
	const entry = await deleteMemory(c.req.param("id"));
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	return c.json({ entry });
});

export default app;
