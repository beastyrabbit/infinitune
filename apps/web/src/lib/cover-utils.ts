// Hash a string to a consistent number for procedural cover generation
export function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

// Get a deterministic color from a hash
function hashColor(hash: number, offset: number): string {
	const hue = ((hash >> offset) * 137) % 360;
	const sat = 40 + ((hash >> (offset + 4)) % 40);
	const light = 20 + ((hash >> (offset + 8)) % 30);
	return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// Accent palette based on hash — returns [bg, accent1, accent2]
export function getCoverColors(
	title: string,
	artistName: string,
): [string, string, string] {
	const hash = hashString(`${title}::${artistName}`);
	return [hashColor(hash, 0), hashColor(hash, 12), hashColor(hash, 24)];
}

// Get initials for fallback cover text
export function getInitials(title: string): string {
	return title
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0])
		.join("")
		.toUpperCase();
}

// Pattern types for procedural covers
export type CoverPattern =
	| "stripes"
	| "grid"
	| "diagonal"
	| "blocks"
	| "circle"
	| "cross";

export function getCoverPattern(title: string): CoverPattern {
	const patterns: CoverPattern[] = [
		"stripes",
		"grid",
		"diagonal",
		"blocks",
		"circle",
		"cross",
	];
	const hash = hashString(title);
	return patterns[hash % patterns.length];
}

// Build a CSS background for a procedural cover pattern
export function getPatternStyle(pattern: CoverPattern): React.CSSProperties {
	switch (pattern) {
		case "stripes":
			return {
				backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.15) 8px, rgba(255,255,255,0.15) 10px)`,
			};
		case "grid":
			return {
				backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.1) 2px, transparent 2px)`,
				backgroundSize: "20px 20px",
			};
		case "diagonal":
			return {
				backgroundImage: `linear-gradient(135deg, rgba(0,0,0,0.4) 25%, transparent 25%)`,
			};
		case "blocks":
			return {
				backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.08) 50%, transparent 50%), linear-gradient(rgba(255,255,255,0.08) 50%, transparent 50%)`,
				backgroundSize: "50% 50%",
			};
		case "circle":
			return {
				backgroundImage: `radial-gradient(circle at center, transparent 30%, rgba(255,255,255,0.12) 31%, rgba(255,255,255,0.12) 32%, transparent 33%)`,
			};
		case "cross":
			return {
				backgroundImage: `linear-gradient(rgba(239,68,68,0.5) 0%, rgba(239,68,68,0.5) 100%), linear-gradient(90deg, transparent 48%, rgba(239,68,68,0.5) 48%, rgba(239,68,68,0.5) 52%, transparent 52%)`,
				backgroundSize: "100% 4px, 4px 100%",
				backgroundPosition: "center, center",
				backgroundRepeat: "no-repeat, no-repeat",
			};
	}
}
