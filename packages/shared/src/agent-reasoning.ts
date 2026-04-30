export const INFINITUNE_AGENT_IDS = [
	"playlist-director",
	"topic-scout",
	"continuity-critic",
	"production-designer",
	"lyric-dramatist",
	"song-spec-writer",
	"persona-analyst",
	"memory-curator",
	"album-curator",
] as const;

export type InfinituneAgentId = (typeof INFINITUNE_AGENT_IDS)[number];

export const AGENT_REASONING_LEVELS = [
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type AgentReasoningLevel = (typeof AGENT_REASONING_LEVELS)[number];

export const DEFAULT_AGENT_REASONING_LEVELS: Record<
	InfinituneAgentId,
	AgentReasoningLevel
> = {
	"playlist-director": "high",
	"topic-scout": "medium",
	"continuity-critic": "high",
	"production-designer": "medium",
	"lyric-dramatist": "low",
	"song-spec-writer": "medium",
	"persona-analyst": "low",
	"memory-curator": "medium",
	"album-curator": "high",
};

export const AGENT_REASONING_LABELS: Record<
	InfinituneAgentId,
	{ label: string; description: string }
> = {
	"playlist-director": {
		label: "Playlist Director",
		description: "Human-facing orchestrator and final plan owner.",
	},
	"topic-scout": {
		label: "Topic Scout",
		description: "Finds fresh lanes from history and memory.",
	},
	"continuity-critic": {
		label: "Continuity Critic",
		description: "Checks drift, repetition, and hard-anchor preservation.",
	},
	"production-designer": {
		label: "Production Designer",
		description: "Tunes rich ACE audio prompts, arrangement, and texture.",
	},
	"lyric-dramatist": {
		label: "Lyric Dramatist",
		description: "Suggests lyrical worlds and vocal-performance angles.",
	},
	"song-spec-writer": {
		label: "Song Spec Writer",
		description: "Produces validated song metadata from the approved slot.",
	},
	"persona-analyst": {
		label: "Persona Analyst",
		description: "Extracts compact musical DNA from completed songs.",
	},
	"memory-curator": {
		label: "Memory Curator",
		description: "Consolidates chat, ratings, and completed-song memory.",
	},
	"album-curator": {
		label: "Album Curator",
		description: "Coordinates album arcs and source-song continuity.",
	},
};

export function getAgentReasoningSettingKey(
	agentId: InfinituneAgentId,
): string {
	return `agentReasoning.${agentId}`;
}

export function isAgentReasoningLevel(
	value: unknown,
): value is AgentReasoningLevel {
	return (
		typeof value === "string" &&
		(AGENT_REASONING_LEVELS as readonly string[]).includes(value)
	);
}

export function normalizeAgentReasoningLevel(
	value: unknown,
	fallback: AgentReasoningLevel = "medium",
): AgentReasoningLevel {
	return isAgentReasoningLevel(value) ? value : fallback;
}
