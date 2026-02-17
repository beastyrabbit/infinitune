import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	PROMPT_OPT_MODEL,
	PROMPT_OPT_PROVIDER,
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

const CandidateSchema = z.object({
	systemPrompt: z.string().min(1),
	changeSummary: z.array(z.string()).default([]),
});

type Fixture = z.infer<typeof FixtureSchema>;
type Task = z.infer<typeof TaskSchema>;
type Judge = z.infer<typeof JudgeSchema>;
type Candidate = z.infer<typeof CandidateSchema>;

interface CaseResult {
	taskId: string;
	caseId: string;
	variantA: string;
	variantB: string;
	outputA: string;
	outputB: string;
	judge: Judge;
}

interface TaskSummary {
	taskId: string;
	winsA: number;
	winsB: number;
	ties: number;
	avgAScore: number;
	avgBScore: number;
	winner: "a" | "b";
}

interface IterationReport {
	iteration: number;
	results: CaseResult[];
	summary: TaskSummary[];
}

function getArg(name: string, fallback?: string): string | undefined {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx + 1 < process.argv.length) {
		return process.argv[idx + 1];
	}
	return fallback;
}

function getArgInt(name: string, fallback: number): number {
	const raw = getArg(name);
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return parsed;
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

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
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
		provider: PROMPT_OPT_PROVIDER,
		model: options.model,
		system: options.systemPrompt,
		prompt: options.input,
		temperature: 0.7,
	});
	return output.trim();
}

async function judgePair(options: {
	model: string;
	task: Task;
	caseId: string;
	input: string;
	outputA: string;
	outputB: string;
}): Promise<Judge> {
	const judgeSystemPrompt = `You are a strict QA reviewer for prompt-regression testing.

Evaluate two candidate outputs against stated criteria.
Penalize hallucinations, instruction drift, and schema/format risk.
Prefer the output that best preserves user intent and controllability.
Return JSON only.`;

	const criteriaText = options.task.criteria
		.map((c, i) => `${i + 1}. ${c}`)
		.join("\n");
	const judgePrompt = `Task: ${options.task.id}
Description: ${options.task.description}
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
		provider: PROMPT_OPT_PROVIDER,
		model: options.model,
		system: judgeSystemPrompt,
		prompt: judgePrompt,
		schema: JudgeSchema,
		schemaName: `prompt_ab_judge_${options.task.id}`,
		temperature: 0.2,
	});
}

function summarizeTask(taskId: string, rows: CaseResult[]): TaskSummary {
	const winsA = rows.filter((r) => r.judge.winner === "a").length;
	const winsB = rows.filter((r) => r.judge.winner === "b").length;
	const ties = rows.filter((r) => r.judge.winner === "tie").length;
	const avgAScore = average(rows.map((r) => r.judge.aScore));
	const avgBScore = average(rows.map((r) => r.judge.bScore));

	let winner: "a" | "b" = "b";
	if (winsA > winsB) winner = "a";
	else if (winsB > winsA) winner = "b";
	else winner = avgAScore >= avgBScore ? "a" : "b";

	return { taskId, winsA, winsB, ties, avgAScore, avgBScore, winner };
}

function formatSummaryMarkdown(summary: TaskSummary[]): string {
	const lines = [
		"| Task | Winner | A Wins | B Wins | Ties | Avg A | Avg B |",
		"|------|--------|--------|--------|------|-------|-------|",
	];
	for (const row of summary) {
		lines.push(
			`| ${row.taskId} | ${row.winner.toUpperCase()} | ${row.winsA} | ${row.winsB} | ${row.ties} | ${row.avgAScore.toFixed(1)} | ${row.avgBScore.toFixed(1)} |`,
		);
	}
	return lines.join("\n");
}

function uniqueNonEmpty(items: string[]): string[] {
	return Array.from(new Set(items.map((x) => x.trim()).filter(Boolean)));
}

async function proposeCandidatePrompt(options: {
	model: string;
	task: Task;
	winnerPrompt: string;
	loserPrompt: string;
	caseResults: CaseResult[];
	iteration: number;
}): Promise<Candidate> {
	const proposerSystem = `You optimize system prompts for LLM reliability.

Rules:
- Preserve the core behavior and output contract.
- Apply only targeted improvements from observed regressions.
- Do not over-constrain creativity.
- Keep wording concise and operational.
- Return JSON only.`;

	const regressions = uniqueNonEmpty(
		options.caseResults.flatMap((r) => r.judge.regressions),
	).slice(0, 12);
	const rationales = uniqueNonEmpty(
		options.caseResults.map((r) => r.judge.rationale),
	).slice(0, 6);

	const criteria = options.task.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
	const cases = options.task.cases
		.map((c, i) => `${i + 1}. (${c.id}) ${c.input}`)
		.join("\n");
	const regressionText = regressions.length
		? regressions.map((r, i) => `${i + 1}. ${r}`).join("\n")
		: "None reported";
	const rationaleText = rationales.length
		? rationales.map((r, i) => `${i + 1}. ${r}`).join("\n")
		: "None reported";

	const prompt = `Task ID: ${options.task.id}
Description: ${options.task.description}
Iteration: ${options.iteration}

Criteria:
${criteria}

Representative inputs:
${cases}

Current winning prompt:
${options.winnerPrompt}

Current losing prompt:
${options.loserPrompt}

Observed regressions:
${regressionText}

Judge rationales:
${rationaleText}

Generate ONE improved candidate system prompt that should beat the current winner while preserving intent.

Return JSON:
- systemPrompt: string
- changeSummary: string[] (up to 6 bullet points)`;

	const candidate = await callLlmObject({
		provider: PROMPT_OPT_PROVIDER,
		model: options.model,
		system: proposerSystem,
		prompt,
		schema: CandidateSchema,
		schemaName: `prompt_candidate_${options.task.id}`,
		temperature: 0.5,
	});

	const cleaned = candidate.systemPrompt.trim();
	if (!cleaned || cleaned.length < 80) {
		return {
			systemPrompt: options.winnerPrompt,
			changeSummary: ["Candidate generation returned prompt that was too short."],
		};
	}

	if (cleaned === options.winnerPrompt.trim()) {
		return {
			systemPrompt: `${cleaned}\n\nOutput format safety: do not use markdown wrappers.`,
			changeSummary: ["Added explicit output format safety clause."],
		};
	}

	return {
		systemPrompt: cleaned,
		changeSummary: candidate.changeSummary.slice(0, 6),
	};
}

async function runIteration(options: {
	model: string;
	fixture: Fixture;
	iteration: number;
}): Promise<IterationReport> {
	const results: CaseResult[] = [];

	for (const task of options.fixture.tasks) {
		const [variantA, variantB] = task.variants;
		log(`Iteration ${options.iteration} task ${task.id}: ${task.description}`);

		for (const c of task.cases) {
			log(`  Case ${c.id}: generating A`);
			const outputA = await generateVariantOutput({
				model: options.model,
				systemPrompt: variantA.systemPrompt,
				input: c.input,
			});

			log(`  Case ${c.id}: generating B`);
			const outputB = await generateVariantOutput({
				model: options.model,
				systemPrompt: variantB.systemPrompt,
				input: c.input,
			});

			log(`  Case ${c.id}: judging`);
			const judge = await judgePair({
				model: options.model,
				task,
				caseId: c.id,
				input: c.input,
				outputA,
				outputB,
			});

			results.push({
				taskId: task.id,
				caseId: c.id,
				variantA: variantA.id,
				variantB: variantB.id,
				outputA,
				outputB,
				judge,
			});
		}
	}

	const summary = options.fixture.tasks.map((task) =>
		summarizeTask(
			task.id,
			results.filter((r) => r.taskId === task.id),
		),
	);

	return { iteration: options.iteration, results, summary };
}

async function buildNextFixture(options: {
	model: string;
	fixture: Fixture;
	report: IterationReport;
	iteration: number;
}): Promise<Fixture> {
	const nextTasks: Task[] = [];

	for (const task of options.fixture.tasks) {
		const taskSummary = options.report.summary.find((s) => s.taskId === task.id);
		if (!taskSummary) {
			nextTasks.push(task);
			continue;
		}

		const [variantA, variantB] = task.variants;
		const winnerVariant = taskSummary.winner === "a" ? variantA : variantB;
		const loserVariant = taskSummary.winner === "a" ? variantB : variantA;
		const taskResults = options.report.results.filter((r) => r.taskId === task.id);

		log(
			`Iteration ${options.iteration} task ${task.id}: winner=${taskSummary.winner.toUpperCase()} (A:${taskSummary.winsA} B:${taskSummary.winsB} T:${taskSummary.ties})`,
		);

		const candidate = await proposeCandidatePrompt({
			model: options.model,
			task,
			winnerPrompt: winnerVariant.systemPrompt,
			loserPrompt: loserVariant.systemPrompt,
			caseResults: taskResults,
			iteration: options.iteration,
		});

		nextTasks.push({
			...task,
			variants: [
				{
					id: `iter${options.iteration}_winner`,
					systemPrompt: winnerVariant.systemPrompt,
				},
				{
					id: `iter${options.iteration + 1}_candidate`,
					systemPrompt: candidate.systemPrompt,
				},
			],
		});
	}

	return { ...options.fixture, tasks: nextTasks };
}

async function main() {
	const fixturePath = getArg(
		"--fixture",
		path.resolve("scripts/fixtures/prompt-optimize.json"),
	);
	const model = getArg("--model", PROMPT_OPT_MODEL) || PROMPT_OPT_MODEL;
	const iterations = getArgInt("--iterations", 5);

	if (!fixturePath) {
		throw new Error("Missing fixture path");
	}

	log(`Loading fixture: ${fixturePath}`);
	let fixture = await loadFixture(fixturePath);
	log(`Fixture "${fixture.name}" with ${fixture.tasks.length} task(s)`);
	log(`Provider: ${PROMPT_OPT_PROVIDER}, model: ${model}, iterations=${iterations}`);

	const startedAt = Date.now();
	const reports: IterationReport[] = [];

	for (let i = 1; i <= iterations; i += 1) {
		const report = await runIteration({
			model,
			fixture,
			iteration: i,
		});
		reports.push(report);

		process.stdout.write(`\nIteration ${i} Summary\n`);
		process.stdout.write(`${formatSummaryMarkdown(report.summary)}\n\n`);

		if (i < iterations) {
			fixture = await buildNextFixture({
				model,
				fixture,
				report,
				iteration: i,
			});
		}
	}

	const lastReport = reports[reports.length - 1];
	if (!lastReport) {
		throw new Error("No iteration reports generated");
	}

	const finalPrompts = fixture.tasks.map((task) => {
		const taskSummary = lastReport.summary.find((s) => s.taskId === task.id);
		const [variantA, variantB] = task.variants;
		const winner = taskSummary?.winner ?? "a";
		const selected = winner === "a" ? variantA.systemPrompt : variantB.systemPrompt;
		return {
			taskId: task.id,
			selectedVariant: winner,
			systemPrompt: selected,
		};
	});

	const elapsedMs = Date.now() - startedAt;
	await mkdir(path.resolve("scripts/results"), { recursive: true });
	const outPath = path.resolve(
		`scripts/results/prompt-optimize-iterative-${timestampForFile()}.json`,
	);

	await writeFile(
		outPath,
		JSON.stringify(
			{
				fixture: fixture.name,
				provider: PROMPT_OPT_PROVIDER,
				model,
				iterations,
				elapsedMs,
				reports,
				finalPrompts,
			},
			null,
			2,
		),
		"utf8",
	);

	log(`Wrote iterative report: ${outPath}`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`prompt-optimize-iterate failed: ${message}\n`);
	process.exit(1);
});
