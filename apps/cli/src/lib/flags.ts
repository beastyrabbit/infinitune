export type ParsedArgs = {
	positionals: string[];
	flags: Map<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
	const flags = new Map<string, string | boolean>();
	const positionals: string[] = [];

	for (let i = 0; i < argv.length; i += 1) {
		const part = argv[i];
		if (!part.startsWith("--")) {
			positionals.push(part);
			continue;
		}

		const eqIndex = part.indexOf("=");
		if (eqIndex !== -1) {
			const key = part.slice(2, eqIndex);
			const value = part.slice(eqIndex + 1);
			flags.set(key, value);
			continue;
		}

		const key = part.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith("--")) {
			flags.set(key, next);
			i += 1;
			continue;
		}
		flags.set(key, true);
	}

	return { positionals, flags };
}

export function getFlagString(
	parsed: ParsedArgs,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = parsed.flags.get(key);
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

export function getFlagNumber(
	parsed: ParsedArgs,
	fallback: number,
	...keys: string[]
): number {
	const raw = getFlagString(parsed, ...keys);
	if (!raw) return fallback;
	const parsedValue = Number(raw);
	if (!Number.isFinite(parsedValue)) return fallback;
	return parsedValue;
}

export function hasFlag(parsed: ParsedArgs, ...keys: string[]): boolean {
	for (const key of keys) {
		if (parsed.flags.has(key)) return true;
	}
	return false;
}
