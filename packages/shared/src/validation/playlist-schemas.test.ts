import { describe, expect, it } from "vitest";
import { hasUnsafeRawPath } from "../raw-path-guard";
import { CreatePlaylistSchema } from "./playlist-schemas";

const playlist = {
	name: "Test playlist",
	prompt: "Jazz",
	llmProvider: "openai-codex",
	llmModel: "",
};

const acceptedKeys = [
	"",
	"global-radio",
	"ab12cd34",
	"a.b",
	".hidden",
	"trailing.",
	"...",
	"a..b",
	"mix 2026",
	"?#&=+:",
	"!~*'()_-",
	"日本語🎵",
	"\t\n\u0000",
	"a".repeat(100),
];

describe("CreatePlaylistSchema playlistKey", () => {
	it.each([
		"mix/2026",
		"/",
		"100%",
		"%2f",
		"%2E",
		"%252f",
		"a\\b",
		"\\",
		".",
		"..",
	])("rejects unsafe key %j with a clear field error", (playlistKey) => {
		const result = CreatePlaylistSchema.safeParse({ ...playlist, playlistKey });
		expect(result.success).toBe(false);
		if (result.success) throw new Error("Expected playlist key rejection");
		expect(result.error.issues).toEqual([
			expect.objectContaining({
				path: ["playlistKey"],
				message:
					"Playlist key must not contain /, \\ or % and must not be . or ..",
			}),
		]);
	});

	it.each(acceptedKeys)("preserves accepted key %j", (playlistKey) => {
		expect(
			CreatePlaylistSchema.parse({ ...playlist, playlistKey }).playlistKey,
		).toBe(playlistKey);
	});

	it("allows an omitted key", () => {
		expect(CreatePlaylistSchema.parse(playlist).playlistKey).toBeUndefined();
	});

	it("keeps accepted sample keys safe after client URL encoding", () => {
		const tokens = [
			"a",
			"0",
			".",
			"..",
			"...",
			" ",
			"?",
			"#",
			"%",
			"/",
			"\\",
			"é",
			"🎵",
		];
		const samples = [
			...acceptedKeys,
			...tokens.flatMap((left) => tokens.map((right) => left + right)),
		];
		for (const playlistKey of samples) {
			const result = CreatePlaylistSchema.safeParse({
				...playlist,
				playlistKey,
			});
			if (!result.success) continue;
			expect(
				hasUnsafeRawPath(
					`/api/playlists/by-key/${encodeURIComponent(playlistKey)}`,
				),
				`Accepted key ${JSON.stringify(playlistKey)} must pass the raw-path guard`,
			).toBe(false);
		}
	});
});
