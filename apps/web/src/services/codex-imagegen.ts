import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 600_000;

function timeoutMs(): number {
	const parsed = Number.parseInt(
		process.env.INFINITUNE_CODEX_IMAGEGEN_TIMEOUT_MS ?? "",
		10,
	);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function runCodex(
	args: string[],
	options: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
	const { cwd, signal, timeoutMs: timeout = timeoutMs() } = options;

	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			return;
		}

		const child = spawn("codex", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		};

		const abort = () => {
			child.kill("SIGTERM");
			finish(new Error("Codex image generation aborted"));
		};

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			finish(new Error("Codex image generation timed out"));
		}, timeout);

		signal?.addEventListener("abort", abort, { once: true });

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			finish(new Error(`Failed to run Codex CLI: ${error.message}`));
		});
		child.on("close", (code) => {
			if (code === 0) {
				finish();
				return;
			}
			const message = (stderr || stdout || `codex exited with code ${code}`)
				.trim()
				.slice(0, 2000);
			finish(new Error(message || `codex exited with code ${code}`));
		});
	});
}

function imageFormat(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
	if (ext === "jpeg") return "jpg";
	if (["png", "jpg", "webp", "avif", "gif"].includes(ext)) return ext;
	return "png";
}

async function findGeneratedImage(dir: string): Promise<string | null> {
	const entries: Array<{ path: string; mtimeMs: number }> = [];

	async function walk(current: string): Promise<void> {
		const dirEntries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of dirEntries) {
			const entryPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(entryPath);
				continue;
			}
			if (!/\.(png|jpe?g|webp|avif|gif)$/i.test(entry.name)) continue;
			const stat = await fs.stat(entryPath);
			entries.push({ path: entryPath, mtimeMs: stat.mtimeMs });
		}
	}

	await walk(dir);
	const preferred = entries.find(
		(entry) => path.basename(entry.path).toLowerCase() === "cover.png",
	);
	if (preferred) return preferred.path;
	entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return entries[0]?.path ?? null;
}

function buildPrompt(coverPrompt: string): string {
	return `$imagegen
Use case: stylized-concept
Asset type: Infinitune automated song cover art
Primary request: Generate one square 1024x1024 image for this cover prompt:
${coverPrompt}

Composition/framing: centered circular CD-disc artwork aesthetic, strong first-read thumbnail composition, no border mockup.
Constraints: no text, no letters, no logo, no watermark, no UI, no extra files except the final image.
Output: Save the final selected image exactly as ./cover.png in the current working directory. Do not ask follow-up questions.`;
}

export async function callCodexImagegenCover(options: {
	prompt: string;
	signal?: AbortSignal;
}): Promise<{ base64: string; format: string }> {
	const jobDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "infinitune-codex-imagegen-"),
	);
	const finalMessagePath = path.join(jobDir, "final-message.txt");
	const prompt = buildPrompt(options.prompt);

	try {
		await runCodex(
			[
				"exec",
				"--skip-git-repo-check",
				"--ephemeral",
				"--full-auto",
				"--sandbox",
				"workspace-write",
				"-C",
				jobDir,
				"--output-last-message",
				finalMessagePath,
				prompt,
			],
			{ cwd: jobDir, signal: options.signal },
		);

		const imagePath = await findGeneratedImage(jobDir);
		if (!imagePath) {
			throw new Error("Codex imagegen did not save a cover image");
		}
		const buffer = await fs.readFile(imagePath);
		return {
			base64: buffer.toString("base64"),
			format: imageFormat(imagePath),
		};
	} finally {
		await fs.rm(jobDir, { recursive: true, force: true });
	}
}
