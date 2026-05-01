import { describe, expect, it } from "vitest";
import { preserveInheritedPlaylistValue } from "../lib/playlist-overrides";

describe("preserveInheritedPlaylistValue", () => {
	it("keeps inherited unset playlist values as null", () => {
		expect(preserveInheritedPlaylistValue("double", "double", null)).toBeNull();
		expect(preserveInheritedPlaylistValue(true, true, undefined)).toBeNull();
	});

	it("returns a playlist override when the value differs from the inherited value", () => {
		expect(preserveInheritedPlaylistValue("high", "double", null)).toBe("high");
		expect(preserveInheritedPlaylistValue(false, true, null)).toBe(false);
	});

	it("keeps an existing override explicit even when it matches the inherited value", () => {
		expect(preserveInheritedPlaylistValue(0.05, 0.05, 0.05)).toBe(0.05);
	});
});
