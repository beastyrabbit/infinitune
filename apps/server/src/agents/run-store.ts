import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { agentRuns } from "../db/schema";

export async function createAgentRun(input: {
	playlistId?: string | null;
	agentId: string;
	sessionKey?: string | null;
	trigger: string;
	input?: unknown;
}) {
	const [row] = await db
		.insert(agentRuns)
		.values({
			createdAt: Date.now(),
			playlistId: input.playlistId ?? null,
			agentId: input.agentId,
			sessionKey: input.sessionKey ?? null,
			trigger: input.trigger,
			status: "running",
			inputJson: input.input === undefined ? null : JSON.stringify(input.input),
		})
		.returning();
	return row;
}

export async function completeAgentRun(
	id: string,
	output?: unknown,
): Promise<void> {
	await db
		.update(agentRuns)
		.set({
			status: "completed",
			outputJson: output === undefined ? null : JSON.stringify(output),
		})
		.where(eq(agentRuns.id, id));
}

export async function failAgentRun(id: string, error: unknown): Promise<void> {
	await db
		.update(agentRuns)
		.set({
			status: "failed",
			error: error instanceof Error ? error.message : String(error),
		})
		.where(eq(agentRuns.id, id));
}
