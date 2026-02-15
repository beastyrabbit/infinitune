/** Generate a random 8-character base36 playlist key */
export function generatePlaylistKey(): string {
	const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
	let key = "";
	for (let i = 0; i < 8; i++) {
		key += chars[Math.floor(Math.random() * chars.length)];
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
