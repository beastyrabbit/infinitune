import fsPromises from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { agentChannelMessages } from "../db/schema";
import { emit } from "../events/event-bus";
import { logger } from "../logger";
import { parseJsonField } from "../wire";

export type ChannelSenderKind = "human" | "agent" | "system" | "tool";
export type ChannelMessageType =
	| "chat"
	| "proposal"
	| "critique"
	| "decision"
	| "question"
	| "memory_note"
	| "tool_summary";
export type ChannelVisibility = "public" | "collapsed";

export interface ChannelMessageWire {
	id: string;
	createdAt: number;
	playlistId: string;
	threadId: string | null;
	senderKind: ChannelSenderKind;
	senderId: string;
	messageType: ChannelMessageType;
	visibility: ChannelVisibility;
	content: string;
	data: unknown;
	correlationId: string | null;
}

export interface PostChannelMessageInput {
	playlistId: string;
	threadId?: string | null;
	senderKind: ChannelSenderKind;
	senderId: string;
	messageType: ChannelMessageType;
	visibility?: ChannelVisibility;
	content: string;
	data?: unknown;
	correlationId?: string | null;
}

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const CHANNEL_FILE_LOGGING_ENABLED =
	!isTest && process.env.AGENT_CHANNEL_LOG_TO_FILE !== "0";
const CHANNEL_LOG_DIR = path.resolve(
	import.meta.dirname,
	"../../../../data/logs/agent-channel",
);

function safeFileSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function formatChannelTranscriptEntry(message: ChannelMessageWire): string {
	const header = [
		`## ${new Date(message.createdAt).toISOString()}`,
		`- playlist: ${message.playlistId}`,
		`- id: ${message.id}`,
		`- sender: ${message.senderKind}/${message.senderId}`,
		`- type: ${message.messageType}`,
		`- visibility: ${message.visibility}`,
		message.threadId ? `- thread: ${message.threadId}` : undefined,
		message.correlationId
			? `- correlation: ${message.correlationId}`
			: undefined,
	]
		.filter(Boolean)
		.join("\n");
	const metadata =
		message.data === null || message.data === undefined
			? ""
			: `\n\n\`\`\`json\n${JSON.stringify(message.data, null, 2)}\n\`\`\``;
	return `${header}\n\n${message.content}${metadata}\n\n`;
}

async function appendChannelMessageLog(
	message: ChannelMessageWire,
): Promise<void> {
	if (!CHANNEL_FILE_LOGGING_ENABLED) return;
	const playlistSegment = safeFileSegment(message.playlistId);
	await fsPromises.mkdir(CHANNEL_LOG_DIR, { recursive: true });
	await Promise.all([
		fsPromises.appendFile(
			path.join(CHANNEL_LOG_DIR, `${playlistSegment}.ndjson`),
			`${JSON.stringify(message)}\n`,
			"utf8",
		),
		fsPromises.appendFile(
			path.join(CHANNEL_LOG_DIR, `${playlistSegment}.md`),
			formatChannelTranscriptEntry(message),
			"utf8",
		),
	]);
}

function toWire(
	row: typeof agentChannelMessages.$inferSelect,
): ChannelMessageWire {
	return {
		id: row.id,
		createdAt: row.createdAt,
		playlistId: row.playlistId,
		threadId: row.threadId,
		senderKind: row.senderKind as ChannelSenderKind,
		senderId: row.senderId,
		messageType: row.messageType as ChannelMessageType,
		visibility: row.visibility as ChannelVisibility,
		content: row.content,
		data: parseJsonField(row.dataJson) ?? null,
		correlationId: row.correlationId,
	};
}

export async function postChannelMessage(
	input: PostChannelMessageInput,
): Promise<ChannelMessageWire> {
	const now = Date.now();
	const [row] = await db
		.insert(agentChannelMessages)
		.values({
			createdAt: now,
			playlistId: input.playlistId,
			threadId: input.threadId ?? null,
			senderKind: input.senderKind,
			senderId: input.senderId,
			messageType: input.messageType,
			visibility: input.visibility ?? "public",
			content: input.content,
			dataJson: input.data === undefined ? null : JSON.stringify(input.data),
			correlationId: input.correlationId ?? null,
		})
		.returning();
	const message = toWire(row);
	emit("agent.chat_message", {
		playlistId: message.playlistId,
		messageId: message.id,
	});
	appendChannelMessageLog(message).catch((err) =>
		logger.warn(
			{ err, playlistId: message.playlistId, messageId: message.id },
			"Failed to append agent channel log",
		),
	);
	return message;
}

export async function getChannelMessage(
	id: string,
): Promise<ChannelMessageWire | null> {
	const [row] = await db
		.select()
		.from(agentChannelMessages)
		.where(eq(agentChannelMessages.id, id));
	return row ? toWire(row) : null;
}

export async function markChannelQuestionAnswered(input: {
	id: string;
	answeredBy: string;
	answerMessageId: string;
}): Promise<ChannelMessageWire | null> {
	const current = await getChannelMessage(input.id);
	if (!current || current.messageType !== "question") return current;
	const data =
		current.data && typeof current.data === "object"
			? { ...(current.data as Record<string, unknown>) }
			: {};
	data.answeredAt = Date.now();
	data.answeredBy = input.answeredBy;
	data.answerMessageId = input.answerMessageId;
	const [row] = await db
		.update(agentChannelMessages)
		.set({ dataJson: JSON.stringify(data) })
		.where(eq(agentChannelMessages.id, input.id))
		.returning();
	const message = row ? toWire(row) : null;
	if (message) {
		emit("agent.chat_message", {
			playlistId: message.playlistId,
			messageId: message.id,
		});
	}
	return message;
}

export async function readChannelMessages(input: {
	playlistId: string;
	threadId?: string | null;
	sinceId?: string | null;
	limit?: number;
	types?: ChannelMessageType[];
}): Promise<ChannelMessageWire[]> {
	const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
	const predicates = [eq(agentChannelMessages.playlistId, input.playlistId)];
	if (input.threadId !== undefined) {
		predicates.push(
			input.threadId === null
				? isNull(agentChannelMessages.threadId)
				: eq(agentChannelMessages.threadId, input.threadId),
		);
	}
	if (input.sinceId) {
		predicates.push(gt(agentChannelMessages.id, input.sinceId));
	}
	if (input.types?.length) {
		predicates.push(inArray(agentChannelMessages.messageType, input.types));
	}

	const rows = await db
		.select()
		.from(agentChannelMessages)
		.where(and(...predicates))
		.orderBy(desc(agentChannelMessages.createdAt))
		.limit(limit);

	return rows.reverse().map(toWire);
}

export async function listPendingRequiredQuestions(
	playlistId: string,
): Promise<ChannelMessageWire[]> {
	const rows = await db
		.select()
		.from(agentChannelMessages)
		.where(
			and(
				eq(agentChannelMessages.playlistId, playlistId),
				eq(agentChannelMessages.messageType, "question"),
			),
		)
		.orderBy(asc(agentChannelMessages.createdAt));

	return rows.map(toWire).filter((message) => {
		const data = message.data as {
			requiresAnswer?: unknown;
			answeredAt?: unknown;
		};
		return data?.requiresAnswer === true && !data.answeredAt;
	});
}
