import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function normalizeEol(source: string): string {
	return source.replace(/\r\n/g, "\n");
}

describe("llm module parity", () => {
	it("keeps server and web llm modules in sync", () => {
		const serverSource = readFileSync(
			new URL("../external/llm.ts", import.meta.url),
			"utf8",
		);
		const webSource = readFileSync(
			new URL("../../../web/src/services/llm.ts", import.meta.url),
			"utf8",
		);

		expect(normalizeEol(webSource)).toBe(normalizeEol(serverSource));
	});
});
