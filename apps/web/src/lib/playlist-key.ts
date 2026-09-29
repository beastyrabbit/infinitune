/** Generate an unpredictable 8-character base36 playlist key. */
export function generatePlaylistKey(): string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
	const random = new Uint32Array(1);
	const uint32Range = 2 ** 32;
	const limit = uint32Range - (uint32Range % chars.length);
	let key = "";
	for (let i = 0; i < 8; i++) {
		do {
			globalThis.crypto.getRandomValues(random);
		} while (random[0] >= limit);
		key += chars[random[0] % chars.length];
	}
	return key;
}

/** TanStack Router search validator for ?pl=xxx&room=xxx&role=xxx&name=xxx&dn=xxx */
export function validatePlaylistKeySearch(search: Record<string, unknown>): {
	pl?: string;
	room?: string;
	role?: "player" | "controller";
	name?: string;
	dn?: string;
} {
	const role =
		search.role === "player" || search.role === "controller"
			? search.role
			: undefined;
	return {
		pl: typeof search.pl === "string" ? search.pl : undefined,
		room: typeof search.room === "string" ? search.room : undefined,
		role,
		name: typeof search.name === "string" ? search.name : undefined,
		dn: typeof search.dn === "string" ? search.dn : undefined,
	};
}
