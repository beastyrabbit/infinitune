import fs from "node:fs"
import path from "node:path"
import { createId } from "@paralleldrive/cuid2"

const COVERS_DIR = path.resolve(import.meta.dirname, "../data/covers")

// Ensure covers directory exists
fs.mkdirSync(COVERS_DIR, { recursive: true })

/**
 * Save a cover image from a Buffer/base64 and return its public URL path.
 */
export function saveCover(
	data: Buffer,
	ext: string = "png",
): { filePath: string; urlPath: string } {
	const filename = `${createId()}.${ext}`
	const filePath = path.join(COVERS_DIR, filename)
	fs.writeFileSync(filePath, data)
	return {
		filePath,
		urlPath: `/covers/${filename}`,
	}
}

/**
 * Save a cover from a URL by downloading it.
 */
export async function saveCoverFromUrl(
	sourceUrl: string,
): Promise<{ filePath: string; urlPath: string }> {
	const response = await fetch(sourceUrl)
	if (!response.ok) throw new Error(`Failed to download cover: ${response.statusText}`)
	const buffer = Buffer.from(await response.arrayBuffer())
	const contentType = response.headers.get("content-type") ?? "image/png"
	const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png"
	return saveCover(buffer, ext)
}

/**
 * Get the filesystem path for the covers directory (for static serving).
 */
export function getCoversDir(): string {
	return COVERS_DIR
}
