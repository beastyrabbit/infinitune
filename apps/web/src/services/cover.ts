import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeImageProvider } from "@infinitune/shared/inference-sh-image-models";
import type { SongCover } from "@infinitune/shared/types";
import { callCodexImagegenCover } from "@/services/codex-imagegen";
import { callInferenceShImageGen } from "@/services/inference-sh";

const execFileAsync = promisify(execFile);

export interface CoverResult {
	imageBase64: string;
	format: string;
}

function sourceExtension(format: string): string {
	const normalized = format.toLowerCase().replace(/^\./, "");
	if (normalized === "jpeg") return "jpg";
	return normalized;
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
	return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function tryGeneratePreviewDerivative(
	command: string,
	args: string[],
	outputPath: string,
	cwd: string,
): Promise<Buffer | null> {
	try {
		await execFileAsync(command, args, { cwd });
		return fs.existsSync(outputPath) ? fs.readFileSync(outputPath) : null;
	} catch {
		return null;
	}
}

async function createPreviewPngBuffer(
	sourceBuffer: Buffer,
	sourcePath: string,
	pngPath: string,
	sourceFormat: string,
	tempDir: string,
): Promise<Buffer | null> {
	if (sourceFormat === "png") {
		fs.writeFileSync(pngPath, sourceBuffer);
		return sourceBuffer;
	}

	const normalized = await tryGeneratePreviewDerivative(
		"magick",
		[sourcePath, "PNG32:cover.png"],
		pngPath,
		tempDir,
	);
	return normalized;
}

export async function createPreviewCover(
	result: CoverResult | null,
): Promise<SongCover | null> {
	if (!result) return null;

	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "infinitune-cover-preview-"),
	);
	const ext = sourceExtension(result.format);
	const sourceBuffer = Buffer.from(result.imageBase64, "base64");
	const sourcePath = path.join(tempDir, `source.${ext}`);
	const pngPath = path.join(tempDir, "cover.png");
	const webpPath = path.join(tempDir, "cover.webp");
	const jxlPath = path.join(tempDir, "cover.jxl");

	try {
		fs.writeFileSync(sourcePath, sourceBuffer);
		const pngBuffer = await createPreviewPngBuffer(
			sourceBuffer,
			sourcePath,
			pngPath,
			ext,
			tempDir,
		);
		if (!pngBuffer) return null;
		const webpBuffer = await tryGeneratePreviewDerivative(
			"magick",
			["cover.png", "-quality", "82", "cover.webp"],
			webpPath,
			tempDir,
		);
		const jxlBuffer = await tryGeneratePreviewDerivative(
			"cjxl",
			["cover.png", "cover.jxl", "--effort=7", "--distance=1.5"],
			jxlPath,
			tempDir,
		);

		return {
			jxlUrl: jxlBuffer ? toDataUrl(jxlBuffer, "image/jxl") : null,
			webpUrl: webpBuffer ? toDataUrl(webpBuffer, "image/webp") : null,
			pngUrl: toDataUrl(pngBuffer, "image/png"),
		};
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

export async function generateCover(options: {
	coverPrompt: string;
	provider: string;
	model?: string;
	signal?: AbortSignal;
}): Promise<CoverResult | null> {
	const { coverPrompt, model, signal } = options;
	const provider = normalizeImageProvider(options.provider);

	const fullPrompt = [
		"Square front album cover artwork for a physical CD jewel case.",
		"Use a 1:1 composition with crisp release-art typography when the prompt names a band and album.",
		"Render only the requested band and album title text; do not add extra words, logos, watermarks, UI, or case mockups.",
		coverPrompt,
	].join(" ");

	if (provider === "codex-imagegen") {
		const result = await callCodexImagegenCover({
			prompt: fullPrompt,
			signal,
		});
		return { imageBase64: result.base64, format: result.format };
	}

	const result = await callInferenceShImageGen({
		model,
		prompt: fullPrompt,
		signal,
	});
	return { imageBase64: result.base64, format: result.format };
}
