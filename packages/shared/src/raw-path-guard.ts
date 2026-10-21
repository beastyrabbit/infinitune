// Inspect the request target before URL parsing or decoding can erase structure.
// Query strings and fragments are outside the path guard.
export function hasUnsafeRawPath(requestPath: string): boolean {
	const rawPath = requestPath.split(/[?#]/, 1)[0];
	return (
		/%(2f|5c|25|2e)/i.test(rawPath) ||
		rawPath.includes("\\") ||
		/(^|\/)\.\.?(\/|$)/.test(rawPath)
	);
}
