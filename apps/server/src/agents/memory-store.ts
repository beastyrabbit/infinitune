import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { agentMemoryEntries } from "../db/schema";
import { emit } from "../events/event-bus";
import { parseJsonField } from "../wire";

export type MemoryScope = "global" | "playlist";
export type MemoryKind =
	| "taste"
	| "avoid"
	| "topic"
	| "constraint"
	| "production"
	| "lyrics"
	| "summary"
	| "feedback";

export interface MemoryEntryWire {
	id: string;
	createdAt: number;
	updatedAt: number;
	scope: MemoryScope;
	playlistId: string | null;
	kind: MemoryKind;
	title: string;
	content: unknown;
	confidence: number;
	importance: number;
	useCount: number;
	lastUsedAt: number | null;
	expiresAt: number | null;
	deletedAt: number | null;
}

export interface WriteMemoryInput {
	scope: MemoryScope;
	playlistId?: string | null;
	kind: MemoryKind;
	title: string;
	content: unknown;
	confidence: number;
	importance: number;
	expiresAt?: number | null;
}

export type MemoryPatch = Partial<WriteMemoryInput>;

function toWire(row: typeof agentMemoryEntries.$inferSelect): MemoryEntryWire {
	return {
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		scope: row.scope as MemoryScope,
		playlistId: row.playlistId,
		kind: row.kind as MemoryKind,
		title: row.title,
		content: parseJsonField(row.contentJson) ?? null,
		confidence: row.confidence,
		importance: row.importance,
		useCount: row.useCount,
		lastUsedAt: row.lastUsedAt,
		expiresAt: row.expiresAt,
		deletedAt: row.deletedAt,
	};
}

function emitMemoryUpdated(row: MemoryEntryWire): void {
	emit("agent.memory_updated", {
		playlistId: row.playlistId,
		memoryId: row.id,
	});
}

export async function searchMemory(input: {
	scope?: MemoryScope;
	playlistId?: string | null;
	query?: string | null;
	kind?: MemoryKind | null;
	limit?: number;
	includeDeleted?: boolean;
}): Promise<MemoryEntryWire[]> {
	const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
	const predicates = [];
	if (!input.includeDeleted)
		predicates.push(isNull(agentMemoryEntries.deletedAt));
	if (input.scope) predicates.push(eq(agentMemoryEntries.scope, input.scope));
	if (input.kind) predicates.push(eq(agentMemoryEntries.kind, input.kind));
	if (input.playlistId !== undefined) {
		predicates.push(
			input.playlistId === null
				? isNull(agentMemoryEntries.playlistId)
				: eq(agentMemoryEntries.playlistId, input.playlistId),
		);
	}
	if (input.query?.trim()) {
		const pattern = `%${input.query.trim()}%`;
		predicates.push(
			or(
				like(agentMemoryEntries.title, pattern),
				like(agentMemoryEntries.contentJson, pattern),
			),
		);
	}

	const rows = await db
		.select()
		.from(agentMemoryEntries)
		.where(predicates.length ? and(...predicates) : undefined)
		.orderBy(
			desc(agentMemoryEntries.importance),
			desc(agentMemoryEntries.updatedAt),
		)
		.limit(limit);
	return rows.map(toWire);
}

export async function getMemory(id: string): Promise<MemoryEntryWire | null> {
	const [row] = await db
		.select()
		.from(agentMemoryEntries)
		.where(eq(agentMemoryEntries.id, id));
	return row ? toWire(row) : null;
}

export async function writeMemory(
	input: WriteMemoryInput,
): Promise<MemoryEntryWire> {
	const now = Date.now();
	const [row] = await db
		.insert(agentMemoryEntries)
		.values({
			createdAt: now,
			updatedAt: now,
			scope: input.scope,
			playlistId:
				input.scope === "playlist" ? (input.playlistId ?? null) : null,
			kind: input.kind,
			title: input.title,
			contentJson: JSON.stringify(input.content),
			confidence: Math.max(0, Math.min(1, input.confidence)),
			importance: Math.max(0, Math.min(1, input.importance)),
			expiresAt: input.expiresAt ?? null,
		})
		.returning();
	const memory = toWire(row);
	emitMemoryUpdated(memory);
	return memory;
}

export async function updateMemory(
	id: string,
	patch: MemoryPatch,
): Promise<MemoryEntryWire | null> {
	const current = await getMemory(id);
	if (!current) return null;
	const [row] = await db
		.update(agentMemoryEntries)
		.set({
			updatedAt: Date.now(),
			scope: patch.scope ?? current.scope,
			playlistId:
				(patch.scope ?? current.scope) === "playlist"
					? (patch.playlistId ?? current.playlistId)
					: null,
			kind: patch.kind ?? current.kind,
			title: patch.title ?? current.title,
			contentJson:
				patch.content === undefined
					? JSON.stringify(current.content)
					: JSON.stringify(patch.content),
			confidence:
				patch.confidence === undefined
					? current.confidence
					: Math.max(0, Math.min(1, patch.confidence)),
			importance:
				patch.importance === undefined
					? current.importance
					: Math.max(0, Math.min(1, patch.importance)),
			expiresAt:
				patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
		})
		.where(eq(agentMemoryEntries.id, id))
		.returning();
	const memory = row ? toWire(row) : null;
	if (memory) emitMemoryUpdated(memory);
	return memory;
}

export async function deleteMemory(
	id: string,
): Promise<MemoryEntryWire | null> {
	const [row] = await db
		.update(agentMemoryEntries)
		.set({ updatedAt: Date.now(), deletedAt: Date.now() })
		.where(eq(agentMemoryEntries.id, id))
		.returning();
	const memory = row ? toWire(row) : null;
	if (memory) emitMemoryUpdated(memory);
	return memory;
}

export async function markMemoryUsed(
	id: string,
): Promise<MemoryEntryWire | null> {
	const [row] = await db
		.update(agentMemoryEntries)
		.set({
			useCount: sql`coalesce(${agentMemoryEntries.useCount}, 0) + 1`,
			lastUsedAt: Date.now(),
			updatedAt: Date.now(),
		})
		.where(eq(agentMemoryEntries.id, id))
		.returning();
	const memory = row ? toWire(row) : null;
	if (memory) emitMemoryUpdated(memory);
	return memory;
}
