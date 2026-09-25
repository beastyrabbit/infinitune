import { describe, expect, it } from "vitest";
import { parseByteRange } from "../routes/songs/byte-range";

describe("parseByteRange", () => {
	it("parses bounded, open and suffix ranges", () => {
		expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
		expect(parseByteRange("bytes=900-", 1000)).toEqual({
			start: 900,
			end: 999,
		});
		expect(parseByteRange("bytes=-100", 1000)).toEqual({
			start: 900,
			end: 999,
		});
	});

	it("clamps the end and suffix length to the file size", () => {
		expect(parseByteRange("bytes=500-5000", 1000)).toEqual({
			start: 500,
			end: 999,
		});
		expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
	});

	it("reports ranges outside the file as unsatisfiable", () => {
		expect(parseByteRange("bytes=999999999-", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=10-5", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
	});

	it("ignores malformed and multi-range headers", () => {
		expect(parseByteRange("bytes=-", 1000)).toBeNull();
		expect(parseByteRange("bytes=0-1,5-9", 1000)).toBeNull();
		expect(parseByteRange("items=0-9", 1000)).toBeNull();
	});
});
