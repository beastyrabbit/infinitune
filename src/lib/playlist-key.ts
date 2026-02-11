/** Generate a random 8-character base36 playlist key */
export function generatePlaylistKey(): string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
	let key = "";
	for (let i = 0; i < 8; i++) {
		key += chars[Math.floor(Math.random() * chars.length)];
	}
	return key;
}

/** TanStack Router search validator for ?pl=xxx */
export function validatePlaylistKeySearch(search: Record<string, unknown>): {
	pl?: string;
} {
	return {
		pl: typeof search.pl === "string" ? search.pl : undefined,
	};
}
