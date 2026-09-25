/**
 * Parse a single-range `Range: bytes=...` header. Returns null when the
 * header should be ignored (malformed or multi-range) and "unsatisfiable"
 * when the range lies outside the file.
 */
export function parseByteRange(
	header: string,
	size: number,
): { start: number; end: number } | "unsatisfiable" | null {
	const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (!match[1] && !match[2])) return null;

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (suffixLength === 0 || size === 0) return "unsatisfiable";
		return { start: Math.max(0, size - suffixLength), end: size - 1 };
	}

	const start = Number(match[1]);
	const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	if (start >= size || (match[2] && Number(match[2]) < start)) {
		return "unsatisfiable";
	}
	return { start, end };
}
