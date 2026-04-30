import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import * as playlistService from "../../services/playlist-service";
import {
	type AgentId,
	assertAgentToolAllowed,
	isAgentToolAllowed,
} from "../agent-registry";
import {
	type ChannelMessageType,
	postChannelMessage,
	readChannelMessages,
} from "../channel-store";

function jsonResult(details: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
	};
}

const MessageTypeSchema = Type.Union([
	Type.Literal("chat"),
	Type.Literal("proposal"),
	Type.Literal("critique"),
	Type.Literal("decision"),
	Type.Literal("question"),
	Type.Literal("memory_note"),
	Type.Literal("tool_summary"),
]);

export function createChannelTools(agentId: AgentId): ToolDefinition[] {
	const tools: ToolDefinition[] = [
		{
			name: "channel_read",
			label: "Read Playlist Channel",
			description:
				"Read recent shared playlist channel messages for coordination.",
			promptSnippet:
				"Read recent playlist channel messages before proposing or deciding.",
			parameters: Type.Object({
				playlistId: Type.String(),
				threadId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
				sinceId: Type.Optional(Type.String()),
				limit: Type.Optional(Type.Number()),
				types: Type.Optional(Type.Array(MessageTypeSchema)),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "channel_read");
				const p = params as {
					playlistId: string;
					threadId?: string | null;
					sinceId?: string;
					limit?: number;
					types?: ChannelMessageType[];
				};
				const messages = await readChannelMessages({
					playlistId: p.playlistId,
					threadId: p.threadId,
					sinceId: p.sinceId,
					limit: p.limit,
					types: p.types,
				});
				return jsonResult({ messages });
			},
		},
		{
			name: "channel_post",
			label: "Post Playlist Channel Message",
			description:
				"Post a structured visible or collapsed message to the playlist channel.",
			promptSnippet:
				"Post proposals, critiques, or tool summaries to the shared channel.",
			parameters: Type.Object({
				playlistId: Type.String(),
				messageType: MessageTypeSchema,
				content: Type.String(),
				data: Type.Optional(Type.Any()),
				threadId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
				visibility: Type.Optional(
					Type.Union([Type.Literal("public"), Type.Literal("collapsed")]),
				),
				correlationId: Type.Optional(Type.String()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "channel_post");
				const p = params as {
					playlistId: string;
					threadId?: string | null;
					messageType: ChannelMessageType;
					visibility?: "public" | "collapsed";
					content: string;
					data?: unknown;
					correlationId?: string | null;
				};
				const message = await postChannelMessage({
					playlistId: p.playlistId,
					threadId: p.threadId,
					senderKind: "agent",
					senderId: agentId,
					messageType: p.messageType,
					visibility: p.visibility,
					content: p.content,
					data: p.data,
					correlationId: p.correlationId,
				});
				return jsonResult({ message });
			},
		},
		{
			name: "channel_decide",
			label: "Post Director Decision",
			description:
				"Post a final playlist director decision. Only the playlist director may use this.",
			promptSnippet:
				"Use only for final director decisions that should steer playlist state.",
			parameters: Type.Object({
				playlistId: Type.String(),
				decisionType: Type.String(),
				content: Type.String(),
				data: Type.Any(),
				correlationId: Type.Optional(Type.String()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "channel_decide");
				const p = params as {
					playlistId: string;
					decisionType: string;
					content: string;
					data: unknown;
					correlationId?: string | null;
				};
				const message = await postChannelMessage({
					playlistId: p.playlistId,
					senderKind: "agent",
					senderId: agentId,
					messageType: "decision",
					content: p.content,
					data: {
						decisionType: p.decisionType,
						...(typeof p.data === "object" && p.data
							? (p.data as Record<string, unknown>)
							: { value: p.data }),
					},
					correlationId: p.correlationId,
				});
				if (p.decisionType === "steering_change") {
					await playlistService.commitDirectorSteeringDecision(p.playlistId, {
						content: p.content,
						data: p.data,
					});
				}
				return jsonResult({ message });
			},
		},
		{
			name: "channel_ask_human",
			label: "Ask Human",
			description:
				"Ask a visible user question. Set requiresAnswer only when generation must wait.",
			promptSnippet:
				"Ask concise user questions only when clarification changes the plan.",
			parameters: Type.Object({
				playlistId: Type.String(),
				content: Type.String(),
				requiresAnswer: Type.Optional(Type.Boolean()),
				data: Type.Optional(Type.Any()),
				correlationId: Type.Optional(Type.String()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "channel_ask_human");
				const p = params as {
					playlistId: string;
					content: string;
					requiresAnswer?: boolean;
					data?: unknown;
					correlationId?: string | null;
				};
				const message = await postChannelMessage({
					playlistId: p.playlistId,
					senderKind: "agent",
					senderId: agentId,
					messageType: "question",
					content: p.content,
					data: {
						...(typeof p.data === "object" && p.data
							? (p.data as Record<string, unknown>)
							: {}),
						requiresAnswer: p.requiresAnswer === true,
					},
					correlationId: p.correlationId,
				});
				return jsonResult({ message });
			},
		},
	];

	return tools.filter((tool) => isAgentToolAllowed(agentId, tool.name));
}
