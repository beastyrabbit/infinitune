import {
	type AgentReasoningLevel,
	DEFAULT_AGENT_REASONING_LEVELS,
	type InfinituneAgentId,
} from "@infinitune/shared/agent-reasoning";

export type AgentId = InfinituneAgentId;

export type AgentRuntime = "pi-session" | "pi-completion";
export type AgentSessionScope = "playlist" | "album-job" | "none";

export type AgentToolName =
	| "channel_read"
	| "channel_post"
	| "channel_decide"
	| "channel_ask_human"
	| "get_playlist_overview"
	| "search_playlist_songs"
	| "get_recent_songs"
	| "get_rated_songs"
	| "get_topic_history"
	| "get_generation_constraints"
	| "save_playlist_plan"
	| "memory_search"
	| "memory_get"
	| "memory_write"
	| "memory_update"
	| "memory_delete"
	| "memory_mark_used"
	| "web_search"
	| "web_fetch_url"
	| "web_search_music_facts"
	| "source_song_candidates";

export interface AgentModelPolicy {
	primary: { provider: "openai-codex"; model: "gpt-5.2" };
	fallback: { provider: "anthropic"; model: "claude-sonnet-4-6" };
	thinkingLevel: AgentReasoningLevel;
}

export interface AgentSpec {
	id: AgentId;
	displayName: string;
	charter: string;
	runtime: AgentRuntime;
	sessionScope: AgentSessionScope;
	modelPolicy: AgentModelPolicy;
	allowedTools: AgentToolName[];
	canWriteMemory: boolean;
	canPostChannel: boolean;
	canMakeFinalDecision: boolean;
	outputSchema: Record<string, unknown>;
	timeouts: {
		turnMs: number;
		toolMs: number;
	};
	fallbackBehavior: string;
}

function modelPolicy(agentId: AgentId): AgentModelPolicy {
	return {
		primary: { provider: "openai-codex", model: "gpt-5.2" },
		fallback: { provider: "anthropic", model: "claude-sonnet-4-6" },
		thinkingLevel: DEFAULT_AGENT_REASONING_LEVELS[agentId],
	};
}

const CHANNEL_TOOLS: AgentToolName[] = ["channel_read", "channel_post"];
const READ_CONTEXT_TOOLS: AgentToolName[] = [
	"get_playlist_overview",
	"search_playlist_songs",
	"get_recent_songs",
	"get_rated_songs",
	"get_topic_history",
	"get_generation_constraints",
	"memory_search",
	"memory_get",
	"memory_mark_used",
];
const DIRECTOR_WRITE_TOOLS: AgentToolName[] = [
	"channel_decide",
	"channel_ask_human",
	"save_playlist_plan",
	"memory_write",
	"memory_update",
	"memory_delete",
];
const MEMORY_WRITE_TOOLS: AgentToolName[] = [
	"memory_write",
	"memory_update",
	"memory_delete",
];
const WEB_RESEARCH_TOOLS: AgentToolName[] = [
	"web_search",
	"web_fetch_url",
	"web_search_music_facts",
	"source_song_candidates",
];

function schema(name: string): Record<string, unknown> {
	return { name, type: "json-object" };
}

export const AGENT_SPECS: Record<AgentId, AgentSpec> = {
	"playlist-director": {
		id: "playlist-director",
		displayName: "Playlist Director",
		charter:
			"Human-facing orchestrator. Preserve the user's original ask, ask clarifying questions when needed, request specialist input, own final playlist plan decisions, and assign distinct source-song choices when the playlist uses reimaginings.",
		runtime: "pi-session",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("playlist-director"),
		allowedTools: [
			...CHANNEL_TOOLS,
			...READ_CONTEXT_TOOLS,
			...DIRECTOR_WRITE_TOOLS,
			...WEB_RESEARCH_TOOLS,
		],
		canWriteMemory: true,
		canPostChannel: true,
		canMakeFinalDecision: true,
		outputSchema: schema("director_decision"),
		timeouts: { turnMs: 120_000, toolMs: 15_000 },
		fallbackBehavior:
			"Save a conservative V2 plan that preserves hard anchors and post a tool summary explaining the fallback.",
	},
	"topic-scout": {
		id: "topic-scout",
		displayName: "Topic Scout",
		charter:
			"Search playlist history, ratings, memory, and generated songs to propose fresh topic lanes and variation moves.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("topic-scout"),
		allowedTools: [
			...CHANNEL_TOOLS,
			...READ_CONTEXT_TOOLS,
			...WEB_RESEARCH_TOOLS,
		],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("topic_lane_proposals"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior:
			"Post no-op topic lanes derived from the prompt and history.",
	},
	"continuity-critic": {
		id: "continuity-critic",
		displayName: "Continuity Critic",
		charter:
			"Check drift, repetition, source-song reuse, contradictions, overuse, and preservation of explicit user anchors. Veto bad plans with structured critique.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("continuity-critic"),
		allowedTools: [
			...CHANNEL_TOOLS,
			...READ_CONTEXT_TOOLS,
			...WEB_RESEARCH_TOOLS,
		],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("continuity_critique"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior: "Approve only plans that keep hard anchors explicit.",
	},
	"production-designer": {
		id: "production-designer",
		displayName: "Production Designer",
		charter:
			"Improve rich ACE-Step audio-type captions: genre stack, groove, arrangement, vocal treatment, production texture/effects, and BPM/key/time/duration consistency without putting those numeric values in the caption.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("production-designer"),
		allowedTools: [...CHANNEL_TOOLS, ...READ_CONTEXT_TOOLS],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("production_directions"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior:
			"Post compact production guardrails from generation constraints.",
	},
	"lyric-dramatist": {
		id: "lyric-dramatist",
		displayName: "Lyric Dramatist",
		charter:
			"Propose lyrical worlds, narrative angles, imagery, and vocal-performance ideas while keeping lyrics varied inside playlist intent.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("lyric-dramatist"),
		allowedTools: [
			...CHANNEL_TOOLS,
			...READ_CONTEXT_TOOLS,
			...WEB_RESEARCH_TOOLS,
		],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("lyric_directions"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior: "Post one narrative variation per planned slot.",
	},
	"song-spec-writer": {
		id: "song-spec-writer",
		displayName: "Song Spec Writer",
		charter:
			"Produce final SongMetadataSchema output from the director-approved brief and slot guidance.",
		runtime: "pi-completion",
		sessionScope: "none",
		modelPolicy: modelPolicy("song-spec-writer"),
		allowedTools: [...CHANNEL_TOOLS, "get_generation_constraints"],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("song_metadata"),
		timeouts: { turnMs: 90_000, toolMs: 10_000 },
		fallbackBehavior:
			"Retry once with stricter schema and duplicate avoidance.",
	},
	"persona-analyst": {
		id: "persona-analyst",
		displayName: "Persona Analyst",
		charter:
			"Extract musical DNA from completed and rated songs, then pass candidate memory through the memory curator.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("persona-analyst"),
		allowedTools: [...CHANNEL_TOOLS, ...READ_CONTEXT_TOOLS],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("persona_extract"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior: "Post a compact taste note from rated song metadata.",
	},
	"memory-curator": {
		id: "memory-curator",
		displayName: "Memory Curator",
		charter:
			"Read, write, update, delete, and consolidate JSON memory entries from ratings, steering, chats, completed songs, and long channel threads.",
		runtime: "pi-completion",
		sessionScope: "playlist",
		modelPolicy: modelPolicy("memory-curator"),
		allowedTools: [
			...CHANNEL_TOOLS,
			...READ_CONTEXT_TOOLS,
			...MEMORY_WRITE_TOOLS,
		],
		canWriteMemory: true,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("memory_operations"),
		timeouts: { turnMs: 60_000, toolMs: 12_000 },
		fallbackBehavior:
			"Write a conservative summary entry or expire weak stale entries.",
	},
	"album-curator": {
		id: "album-curator",
		displayName: "Album Curator",
		charter:
			"Coordinate album arc, track positions, and continuity from source-song identity across an album job.",
		runtime: "pi-session",
		sessionScope: "album-job",
		modelPolicy: modelPolicy("album-curator"),
		allowedTools: [...CHANNEL_TOOLS, ...READ_CONTEXT_TOOLS],
		canWriteMemory: false,
		canPostChannel: true,
		canMakeFinalDecision: false,
		outputSchema: schema("album_arc"),
		timeouts: { turnMs: 120_000, toolMs: 15_000 },
		fallbackBehavior:
			"Use source-song continuity and vary track energy by position.",
	},
};

export const BUILTIN_PI_TOOL_NAMES = [
	"bash",
	"read",
	"write",
	"edit",
	"grep",
	"find",
	"ls",
] as const;

export function getAgentSpec(agentId: AgentId): AgentSpec {
	return AGENT_SPECS[agentId];
}

export function listAgentSpecs(): AgentSpec[] {
	return Object.values(AGENT_SPECS);
}

export function isAgentToolAllowed(
	agentId: AgentId,
	toolName: string,
): toolName is AgentToolName {
	return AGENT_SPECS[agentId].allowedTools.includes(toolName as AgentToolName);
}

export function assertAgentToolAllowed(
	agentId: AgentId,
	toolName: AgentToolName,
): void {
	if (!isAgentToolAllowed(agentId, toolName)) {
		throw new Error(`${agentId} is not allowed to use ${toolName}`);
	}
}

export function getPiToolAllowlist(agentId: AgentId): AgentToolName[] {
	return [...AGENT_SPECS[agentId].allowedTools];
}

export function getAgentSessionKey(
	agentId: AgentId,
	scopeId?: string | null,
): string {
	const spec = getAgentSpec(agentId);
	if (spec.sessionScope === "none") return agentId;
	return `${agentId}:${scopeId ?? "global"}`;
}
