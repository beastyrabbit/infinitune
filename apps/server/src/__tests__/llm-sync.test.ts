import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("llm module parity", () => {
	it("keeps LLM logic backend-owned and web routes proxied", () => {
		const removedWebModule = new URL(
			"../../../web/src/services/llm.ts",
			import.meta.url,
		);
		expect(existsSync(removedWebModule)).toBe(false);

		const proxyModule = readFileSync(
			new URL("../../../web/src/lib/autoplayer-proxy.ts", import.meta.url),
			"utf8",
		);
		expect(proxyModule).toContain("proxyAutoplayerRequest");

		const generateSongRoute = readFileSync(
			new URL(
				"../../../web/src/routes/api.autoplayer.generate-song.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(generateSongRoute).toContain("proxyAutoplayerRequest");
		expect(generateSongRoute).toContain('"/generate-song"');
	});
});
