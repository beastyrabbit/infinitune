import { type Context, Hono } from "hono";
import z from "zod";
import {
	deleteMemory,
	getMemory,
	MAX_MEMORY_TITLE_CHARS,
	type MemoryEntryWire,
	type MemoryKind,
	type MemoryPatch,
	type MemoryScope,
	searchMemory,
	stringifyMemoryContent,
	updateMemory,
	writeMemory,
} from "../agents/memory-store";
import { getRequestActor, type RequestActor } from "../auth/actor";
import * as playlistService from "../services/playlist-service";
import { type PlaylistWire, playlistToWire } from "../wire";

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

const MemoryContentSchema = z.unknown().superRefine((value, ctx) => {
	try {
		stringifyMemoryContent(value);
	} catch (error) {
		ctx.addIssue({
			code: "custom",
			message:
				error instanceof Error
					? error.message
					: "Memory content JSON is too large",
		});
	}
});

const WriteMemorySchema = z.object({
	scope: MemoryScopeSchema,
	playlistId: z.string().nullable().optional(),
	kind: MemoryKindSchema,
	title: z.string().trim().min(1).max(MAX_MEMORY_TITLE_CHARS),
	content: MemoryContentSchema,
	confidence: z.number().min(0).max(1),
	importance: z.number().min(0).max(1),
	expiresAt: z.number().nullable().optional(),
});

const PatchMemorySchema = z.object({
	scope: MemoryScopeSchema.optional(),
	playlistId: z.string().nullable().optional(),
	kind: MemoryKindSchema.optional(),
	title: z.string().trim().min(1).max(MAX_MEMORY_TITLE_CHARS).optional(),
	content: MemoryContentSchema.optional(),
	confidence: z.number().min(0).max(1).optional(),
	importance: z.number().min(0).max(1).optional(),
	expiresAt: z.number().nullable().optional(),
});

function parseLimit(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function canAccessPlaylist(
	actor: RequestActor,
	playlist: PlaylistWire,
): boolean {
	if (!playlist.ownerUserId) return true;
	return actor.kind === "user" && playlist.ownerUserId === actor.userId;
}

async function canAccessPlaylistId(
	actor: RequestActor,
	playlistId: string | null | undefined,
): Promise<boolean> {
	if (!playlistId) return false;
	const playlist = await playlistService.getById(playlistId);
	return playlist ? canAccessPlaylist(actor, playlistToWire(playlist)) : false;
}

async function canReadMemoryEntry(
	actor: RequestActor,
	entry: MemoryEntryWire,
): Promise<boolean> {
	if (entry.scope === "global") return actor.kind === "user";
	return await canAccessPlaylistId(actor, entry.playlistId);
}

async function canWriteMemoryInput(
	actor: RequestActor,
	input: { scope?: MemoryScope; playlistId?: string | null },
): Promise<boolean> {
	if (input.scope === "global") return actor.kind === "user";
	return await canAccessPlaylistId(actor, input.playlistId);
}

async function getAuthorizedMemoryEntry(c: Context): Promise<
	| {
			actor: RequestActor;
			entry: MemoryEntryWire;
	  }
	| Response
> {
	const actor = await getRequestActor(c);
	const entry = await getMemory(c.req.param("id"));
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	if (!(await canReadMemoryEntry(actor, entry))) {
		return c.json({ error: "Memory entry not found" }, 404);
	}
	return { actor, entry };
}

app.get("/", async (c) => {
	const actor = await getRequestActor(c);
	const scope = MemoryScopeSchema.safeParse(c.req.query("scope"));
	const kind = MemoryKindSchema.safeParse(c.req.query("kind"));
	const playlistId = c.req.query("playlistId");
	const resolvedScope = scope.success ? (scope.data as MemoryScope) : undefined;
	if (resolvedScope === "global") {
		if (actor.kind !== "user") return c.json({ entries: [] });
		const entries = await searchMemory({
			scope: "global",
			playlistId: null,
			query: c.req.query("query"),
			kind: kind.success ? (kind.data as MemoryKind) : undefined,
			limit: parseLimit(c.req.query("limit")),
		});
		return c.json({ entries });
	}
	if (!playlistId) {
		return c.json({ error: "playlistId is required" }, 400);
	}
	if (!(await canAccessPlaylistId(actor, playlistId))) {
		return c.json({ error: "Playlist not found" }, 404);
	}
	const entries = await searchMemory({
		scope: resolvedScope,
		playlistId,
		query: c.req.query("query"),
		kind: kind.success ? (kind.data as MemoryKind) : undefined,
		limit: parseLimit(c.req.query("limit")),
	});
	return c.json({ entries });
});

app.get("/:id", async (c) => {
	const access = await getAuthorizedMemoryEntry(c);
	if (access instanceof Response) return access;
	return c.json({ entry: access.entry });
});

app.post("/", async (c) => {
	const actor = await getRequestActor(c);
	const body = await c.req.json();
	const result = WriteMemorySchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	if (!(await canWriteMemoryInput(actor, result.data))) {
		return c.json({ error: "Not authorized to write memory" }, 403);
	}
	return c.json({ entry: await writeMemory(result.data) });
});

app.patch("/:id", async (c) => {
	const access = await getAuthorizedMemoryEntry(c);
	if (access instanceof Response) return access;
	const body = await c.req.json();
	const result = PatchMemorySchema.safeParse(body);
	if (!result.success) return c.json({ error: result.error.message }, 400);
	const target = {
		scope: result.data.scope ?? access.entry.scope,
		playlistId: result.data.playlistId ?? access.entry.playlistId,
	};
	if (!(await canWriteMemoryInput(access.actor, target))) {
		return c.json({ error: "Not authorized to write memory" }, 403);
	}
	const entry = await updateMemory(access.entry.id, result.data as MemoryPatch);
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	return c.json({ entry });
});

app.delete("/:id", async (c) => {
	const access = await getAuthorizedMemoryEntry(c);
	if (access instanceof Response) return access;
	const entry = await deleteMemory(access.entry.id);
	if (!entry) return c.json({ error: "Memory entry not found" }, 404);
	return c.json({ entry });
});

export default app;
