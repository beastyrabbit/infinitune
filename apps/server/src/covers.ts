import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SongCover } from "@infinitune/shared/types";
import { createId } from "@paralleldrive/cuid2";

const COVERS_DIR = path.resolve(import.meta.dirname, "../../../data/covers");

fs.mkdirSync(COVERS_DIR, { recursive: true });

export interface SavedCoverSet {
	cover: SongCover;
	filePaths: {
		pngPath: string;
		webpPath: string | null;
		jxlPath: string | null;
	};
}

function normalizeSourceExtension(sourceFormat?: string): string {
	const normalized = sourceFormat?.trim().toLowerCase().replace(/^\./, "");
	if (!normalized) return "png";
	if (normalized === "jpeg") return "jpg";
	if (normalized === "image/png") return "png";
	if (normalized === "image/jpeg") return "jpg";
	if (normalized === "image/webp") return "webp";
	return normalized;
}

function buildCover(id: string, hasWebp: boolean, hasJxl: boolean): SongCover {
	return {
		pngUrl: `/covers/${id}.png`,
		webpUrl: hasWebp ? `/covers/${id}.webp` : null,
		jxlUrl: hasJxl ? `/covers/${id}.jxl` : null,
	};
}

function tryGenerateDerivative(
	command: string,
	args: string[],
	outputPath: string,
	cwd: string,
): boolean {
	try {
		execFileSync(command, args, { cwd, stdio: "pipe" });
		return fs.existsSync(outputPath);
	} catch {
		return false;
	}
}

function writePngFallback(
	sourcePath: string,
	normalizedPngPath: string,
	finalPngPath: string,
	sourceExtension: string,
	tempDir: string,
): void {
	if (sourceExtension === "png") {
		fs.copyFileSync(sourcePath, normalizedPngPath);
		fs.copyFileSync(sourcePath, finalPngPath);
		return;
	}

	const normalized = tryGenerateDerivative(
		"magick",
		[sourcePath, "PNG32:normalized.png"],
		normalizedPngPath,
		tempDir,
	);
	if (!normalized) {
		throw new Error("Failed to normalize cover to PNG");
	}
	fs.copyFileSync(normalizedPngPath, finalPngPath);
}

export function saveCover(data: Buffer, sourceFormat = "png"): SavedCoverSet {
	const id = createId();
	const ext = normalizeSourceExtension(sourceFormat);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "infinitune-cover-"));
	const sourcePath = path.join(tempDir, `source.${ext}`);
	const normalizedPngPath = path.join(tempDir, "normalized.png");
	const webpPath = path.join(tempDir, "cover.webp");
	const jxlPath = path.join(tempDir, "cover.jxl");
	const finalPngPath = path.join(COVERS_DIR, `${id}.png`);
	const finalWebpPath = path.join(COVERS_DIR, `${id}.webp`);
	const finalJxlPath = path.join(COVERS_DIR, `${id}.jxl`);

	try {
		fs.writeFileSync(sourcePath, data);
		writePngFallback(sourcePath, normalizedPngPath, finalPngPath, ext, tempDir);

		const hasWebp = tryGenerateDerivative(
			"magick",
			["normalized.png", "-quality", "82", "cover.webp"],
			webpPath,
			tempDir,
		);
		if (hasWebp) {
			fs.copyFileSync(webpPath, finalWebpPath);
		}

		const hasJxl = tryGenerateDerivative(
			"cjxl",
			["normalized.png", "cover.jxl", "--effort=7", "--distance=1.5"],
			jxlPath,
			tempDir,
		);
		if (hasJxl) {
			fs.copyFileSync(jxlPath, finalJxlPath);
		}

		return {
			cover: buildCover(id, hasWebp, hasJxl),
			filePaths: {
				pngPath: finalPngPath,
				webpPath: hasWebp ? finalWebpPath : null,
				jxlPath: hasJxl ? finalJxlPath : null,
			},
		};
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

export async function saveCoverFromUrl(
	sourceUrl: string,
): Promise<SavedCoverSet> {
	const response = await fetch(sourceUrl);
	if (!response.ok)
		throw new Error(`Failed to download cover: ${response.statusText}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	const contentType = response.headers.get("content-type") ?? "image/png";
	return saveCover(buffer, contentType);
}

export function getCoversDir(): string {
	return COVERS_DIR;
}
