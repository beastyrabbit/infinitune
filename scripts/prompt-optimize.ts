import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	PROMPT_OPTIMIZATION_MODEL,
	PROMPT_OPTIMIZATION_PROVIDER,
} from "@infinitune/shared/text-llm-profile";
import z from "zod";
import { callLlmObject, callLlmText } from "../apps/server/src/external/llm-client";

const VariantSchema = z.object({
	id: z.string().min(1),
	systemPrompt: z.string().min(1),
});

const TaskCaseSchema = z.object({
	id: z.string().min(1),
	input: z.string().min(1),
});

const TaskSchema = z.object({
	id: z.string().min(1),
	description: z.string().min(1),
	criteria: z.array(z.string().min(1)).min(1),
	variants: z.tuple([VariantSchema, VariantSchema]),
	cases: z.array(TaskCaseSchema).min(1),
});

const FixtureSchema = z.object({
	name: z.string().min(1),
	tasks: z.array(TaskSchema).min(1),
});

const JudgeSchema = z.object({
	winner: z.enum(["a", "b", "tie"]),
	aScore: z.number().min(0).max(100),
	bScore: z.number().min(0).max(100),
	regressions: z.array(z.string()),
	rationale: z.string(),
});

type Fixture = z.infer<typeof FixtureSchema>;

function getArg(name: string, fallback?: string): string | undefined {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx + 1 < process.argv.length) {
		return process.argv[idx + 1];
	}
	return fallback;
}

function timestampForFile(now = new Date()): string {
	return now.toISOString().replace(/[:.]/g, "-");
}

function log(msg: string): void {
	const time = new Date().toISOString();
	process.stdout.write(`[${time}] ${msg}\n`);
}

function truncate(value: string, max = 1600): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}…`;
}

async function loadFixture(filePath: string): Promise<Fixture> {
	const raw = await readFile(filePath, "utf8");
	return FixtureSchema.parse(JSON.parse(raw));
}

async function generateVariantOutput(options: {
	model: string;
	systemPrompt: string;
	input: string;
}): Promise<string> {
	const output = await callLlmText({
		provider: PROMPT_OPTIMIZATION_PROVIDER,
		model: options.model,
		system: options.systemPrompt,
		prompt: options.input,
		temperature: 0.7,
	});
	return output.trim();
}

async function judgePair(options: {
	model: string;
	taskId: string;
	taskDescription: string;
	criteria: string[];
	caseId: string;
	input: string;
	outputA: string;
	outputB: string;
}): Promise<z.infer<typeof JudgeSchema>> {
	const judgeSystemPrompt = `You are a strict QA reviewer for prompt-regression testing.

Score two candidate outputs against criteria.
Penalize hallucinations, instruction drift, and missed constraints.
Prefer the output that best preserves user intent and controllability.
Return JSON only.`;

	const criteriaText = options.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
	const judgePrompt = `Task: ${options.taskId}
Description: ${options.taskDescription}
Case: ${options.caseId}

Input:
${options.input}

Criteria:
${criteriaText}

Output A:
${truncate(options.outputA)}

Output B:
${truncate(options.outputB)}

Return JSON fields:
- winner: "a" | "b" | "tie"
- aScore: number 0..100
- bScore: number 0..100
- regressions: string[]
- rationale: short explanation`;

	return await callLlmObject({
		provider: PROMPT_OPTIMIZATION_PROVIDER,
		model: options.model,
		system: judgeSystemPrompt,
		prompt: judgePrompt,
		schema: JudgeSchema,
		schemaName: "prompt_ab_judge",
		temperature: 0.2,
	});
}

async function main() {
	const fixturePath = getArg(
		"--fixture",
		path.resolve("scripts/fixtures/prompt-optimize.json"),
	);
	const model =
		getArg("--model", PROMPT_OPTIMIZATION_MODEL) ||
		PROMPT_OPTIMIZATION_MODEL;
	const dryRun = process.argv.includes("--dry-run");

	if (!fixturePath) {
		throw new Error("Missing fixture path");
	}

	log(`Loading fixture: ${fixturePath}`);
	const fixture = await loadFixture(fixturePath);
	log(`Fixture "${fixture.name}" with ${fixture.tasks.length} task(s)`);
	log(`Provider: ${PROMPT_OPTIMIZATION_PROVIDER}, model: ${model}`);
	if (dryRun) {
		log("Dry run only. Fixture parsed successfully; no model calls executed.");
		return;
	}

	const startedAt = Date.now();
	const results: Array<{
		taskId: string;
		caseId: string;
		variantA: string;
		variantB: string;
		outputA: string;
		outputB: string;
		judge: z.infer<typeof JudgeSchema>;
	}> = [];

	for (const task of fixture.tasks) {
		const [variantA, variantB] = task.variants;
		log(`Task ${task.id}: ${task.description}`);

		for (const item of task.cases) {
			log(`  Case ${item.id}: generating A`);
			const outputA = await generateVariantOutput({
				model,
				systemPrompt: variantA.systemPrompt,
				input: item.input,
			});

			log(`  Case ${item.id}: generating B`);
			const outputB = await generateVariantOutput({
				model,
				systemPrompt: variantB.systemPrompt,
				input: item.input,
			});

			log(`  Case ${item.id}: judging`);
			const judge = await judgePair({
				model,
				taskId: task.id,
				taskDescription: task.description,
				criteria: task.criteria,
				caseId: item.id,
				input: item.input,
				outputA,
				outputB,
			});

			results.push({
				taskId: task.id,
				caseId: item.id,
				variantA: variantA.id,
				variantB: variantB.id,
				outputA,
				outputB,
				judge,
			});
		}
	}

	const elapsedMs = Date.now() - startedAt;
	const winsA = results.filter((r) => r.judge.winner === "a").length;
	const winsB = results.filter((r) => r.judge.winner === "b").length;
	const ties = results.filter((r) => r.judge.winner === "tie").length;

	process.stdout.write("\nResults\n");
	process.stdout.write("| Task | Case | Winner | A Score | B Score |\n");
	process.stdout.write("|------|------|--------|---------|---------|\n");
	for (const row of results) {
		process.stdout.write(
			`| ${row.taskId} | ${row.caseId} | ${row.judge.winner.toUpperCase()} | ${row.judge.aScore.toFixed(1)} | ${row.judge.bScore.toFixed(1)} |\n`,
		);
	}
	process.stdout.write(
		`\nSummary: A wins=${winsA}, B wins=${winsB}, ties=${ties}, elapsed=${(
			elapsedMs / 1000
		).toFixed(1)}s\n`,
	);

	await mkdir(path.resolve("scripts/results"), { recursive: true });
	const outPath = path.resolve(
		`scripts/results/prompt-optimize-${timestampForFile()}.json`,
	);
	await writeFile(
		outPath,
		JSON.stringify(
			{
				fixture: fixture.name,
				provider: PROMPT_OPTIMIZATION_PROVIDER,
				model,
				elapsedMs,
				summary: { winsA, winsB, ties },
				results,
			},
			null,
			2,
		),
		"utf8",
	);
	log(`Wrote report: ${outPath}`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`prompt-optimize failed: ${message}\n`);
	process.exit(1);
});
