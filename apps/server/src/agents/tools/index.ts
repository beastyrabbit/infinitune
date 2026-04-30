import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { AgentId } from "../agent-registry";
import { createChannelTools } from "./channel-tools";
import { createMemoryTools } from "./memory-tools";
import { createPlaylistContextTools } from "./playlist-context-tools";
import { createWebResearchTools } from "./web-tools";

export function createAgentTools(agentId: AgentId): ToolDefinition[] {
	return [
		...createChannelTools(agentId),
		...createPlaylistContextTools(agentId),
		...createMemoryTools(agentId),
		...createWebResearchTools(agentId),
	];
}
