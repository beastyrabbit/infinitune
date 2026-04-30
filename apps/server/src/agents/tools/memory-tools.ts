import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
	type AgentId,
	assertAgentToolAllowed,
	isAgentToolAllowed,
} from "../agent-registry";
import {
	deleteMemory,
	getMemory,
	MAX_MEMORY_TITLE_CHARS,
	type MemoryKind,
	type MemoryPatch,
	type MemoryScope,
	markMemoryUsed,
	searchMemory,
	updateMemory,
	writeMemory,
} from "../memory-store";

function jsonResult(details: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
	};
}

const ScopeSchema = Type.Union([
	Type.Literal("global"),
	Type.Literal("playlist"),
]);
const KindSchema = Type.Union([
	Type.Literal("taste"),
	Type.Literal("avoid"),
	Type.Literal("topic"),
	Type.Literal("constraint"),
	Type.Literal("production"),
	Type.Literal("lyrics"),
	Type.Literal("summary"),
	Type.Literal("feedback"),
]);

function clampLimit(value: unknown, fallback: number): number {
	const parsed = typeof value === "number" ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(parsed, 100));
}

export function createMemoryTools(agentId: AgentId): ToolDefinition[] {
	const tools: ToolDefinition[] = [
		{
			name: "memory_search",
			label: "Search Memory",
			description:
				"Search global or playlist JSON memory entries. Human edits are returned only as current memory content.",
			promptSnippet: "Search memory before making taste or continuity claims.",
			parameters: Type.Object({
				scope: Type.Optional(ScopeSchema),
				playlistId: Type.Optional(Type.String()),
				query: Type.Optional(Type.String()),
				kind: Type.Optional(KindSchema),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_search");
				const p = params as {
					scope?: MemoryScope;
					playlistId?: string;
					query?: string;
					kind?: MemoryKind;
					limit?: number;
				};
				return jsonResult({
					entries: await searchMemory({
						scope: p.scope,
						playlistId: p.playlistId,
						query: p.query,
						kind: p.kind,
						limit: clampLimit(p.limit, 20),
					}),
				});
			},
		},
		{
			name: "memory_get",
			label: "Get Memory",
			description:
				"Read one JSON memory entry by ID without audit or provenance metadata.",
			promptSnippet: "Use exact memory by ID when referenced by another tool.",
			parameters: Type.Object({ id: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_get");
				const p = params as { id: string };
				return jsonResult({ entry: await getMemory(p.id) });
			},
		},
		{
			name: "memory_write",
			label: "Write Memory",
			description:
				"Write a compact JSON memory entry. Only playlist director and memory curator may use this.",
			promptSnippet:
				"Write memory only for stable, reusable user taste or constraints.",
			parameters: Type.Object({
				scope: ScopeSchema,
				playlistId: Type.Optional(Type.String()),
				kind: KindSchema,
				title: Type.String({ maxLength: MAX_MEMORY_TITLE_CHARS }),
				content: Type.Any(),
				confidence: Type.Number(),
				importance: Type.Number(),
				expiresAt: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_write");
				const p = params as {
					scope: MemoryScope;
					playlistId?: string;
					kind: MemoryKind;
					title: string;
					content: unknown;
					confidence: number;
					importance: number;
					expiresAt?: number | null;
				};
				return jsonResult({
					entry: await writeMemory({
						scope: p.scope,
						playlistId: p.playlistId,
						kind: p.kind,
						title: p.title,
						content: p.content,
						confidence: p.confidence,
						importance: p.importance,
						expiresAt: p.expiresAt,
					}),
				});
			},
		},
		{
			name: "memory_update",
			label: "Update Memory",
			description:
				"Patch a JSON memory entry. Only playlist director and memory curator may use this.",
			promptSnippet:
				"Update memory by replacing noisy content with compact JSON.",
			parameters: Type.Object({
				id: Type.String(),
				patch: Type.Object({
					scope: Type.Optional(ScopeSchema),
					playlistId: Type.Optional(Type.String()),
					kind: Type.Optional(KindSchema),
					title: Type.Optional(
						Type.String({ maxLength: MAX_MEMORY_TITLE_CHARS }),
					),
					content: Type.Optional(Type.Any()),
					confidence: Type.Optional(Type.Number()),
					importance: Type.Optional(Type.Number()),
					expiresAt: Type.Optional(Type.Number()),
				}),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_update");
				const p = params as { id: string; patch: MemoryPatch };
				return jsonResult({
					entry: await updateMemory(p.id, p.patch),
				});
			},
		},
		{
			name: "memory_delete",
			label: "Delete Memory",
			description:
				"Soft delete a JSON memory entry. Only playlist director and memory curator may use this.",
			promptSnippet:
				"Delete memory only when it is stale, weak, or contradicted.",
			parameters: Type.Object({ id: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_delete");
				const p = params as { id: string };
				return jsonResult({ entry: await deleteMemory(p.id) });
			},
		},
		{
			name: "memory_mark_used",
			label: "Mark Memory Used",
			description:
				"Increment use count and last-used timestamp for a memory entry.",
			promptSnippet: "Mark memory used when it materially affects a decision.",
			parameters: Type.Object({ id: Type.String() }),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "memory_mark_used");
				const p = params as { id: string };
				return jsonResult({ entry: await markMemoryUsed(p.id) });
			},
		},
	];

	return tools.filter((tool) => isAgentToolAllowed(agentId, tool.name));
}
