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
		pngPath: string | null;
		webpPath: string | null;
		jxlPath: string | null;
	};
}

function normalizeSourceExtension(sourceFormat?: string): string {
	const normalized = sourceFormat
		?.trim()
		.toLowerCase()
		.split(";")[0]
		?.replace(/^\./, "");
	if (!normalized) return "png";

	switch (normalized) {
		case "png":
		case "image/png":
			return "png";
		case "jpg":
		case "jpeg":
		case "image/jpg":
		case "image/jpeg":
			return "jpg";
		case "webp":
		case "image/webp":
			return "webp";
		case "jxl":
		case "image/jxl":
			return "jxl";
		case "avif":
		case "image/avif":
			return "avif";
		case "gif":
		case "image/gif":
			return "gif";
	}

	const fallback = normalized.startsWith("image/")
		? normalized.slice("image/".length)
		: normalized;
	return fallback.replace(/[^a-z0-9]+/g, "") || "png";
}

function buildCover(
	id: string,
	hasPng: boolean,
	hasWebp: boolean,
	hasJxl: boolean,
): SongCover {
	return {
		pngUrl: hasPng ? `/covers/${id}.png` : null,
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
): boolean {
	if (sourceExtension === "png") {
		fs.copyFileSync(sourcePath, normalizedPngPath);
		fs.copyFileSync(sourcePath, finalPngPath);
		return true;
	}

	const normalized = tryGenerateDerivative(
		"magick",
		[sourcePath, "PNG32:normalized.png"],
		normalizedPngPath,
		tempDir,
	);
	if (!normalized) {
		console.warn(
			`[covers] Failed to normalize cover format "${sourceExtension}", skipping PNG fallback`,
		);
		return false;
	}
	fs.copyFileSync(normalizedPngPath, finalPngPath);
	return true;
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
		const hasNormalizedPng = writePngFallback(
			sourcePath,
			normalizedPngPath,
			finalPngPath,
			ext,
			tempDir,
		);

		const hasWebp = hasNormalizedPng
			? tryGenerateDerivative(
					"magick",
					["normalized.png", "-quality", "82", "cover.webp"],
					webpPath,
					tempDir,
				)
			: false;
		if (hasWebp) {
			fs.copyFileSync(webpPath, finalWebpPath);
		}

		const hasJxl = hasNormalizedPng
			? tryGenerateDerivative(
					"cjxl",
					["normalized.png", "cover.jxl", "--effort=7", "--distance=1.5"],
					jxlPath,
					tempDir,
				)
			: false;
		if (hasJxl) {
			fs.copyFileSync(jxlPath, finalJxlPath);
		}

		return {
			cover: buildCover(id, hasNormalizedPng, hasWebp, hasJxl),
			filePaths: {
				pngPath: hasNormalizedPng ? finalPngPath : null,
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
