import { hasUnsafeRawPath } from "@infinitune/shared/raw-path-guard";
import { describe, expect, it } from "vitest";

describe("shared raw-path predicate", () => {
	it.each([
		"/api/playlists/X%252F..%252F..%252F..%252Fprivacy",
		"/a%2fb",
		"/a%2Fb",
		"/a%5cb",
		"/a%5Cb",
		"/a%25b",
		"/a%2eb",
		"/a%2Eb",
		"/a\\b",
		"/./privacy",
		"/a/../privacy",
		"/a/.",
		"/a/..",
		".",
		"..",
	])("rejects structural path %s", (path) => {
		expect(hasUnsafeRawPath(path)).toBe(true);
	});

	it.each([
		"/health",
		"/api/songs/tz4a98xxat96iws9zmbrgj3a/audio",
		"/covers/tz4a98xxat96iws9zmbrgj3a.png",
		"/api/playlists/by-key/private",
		"/ws",
		"/ws/playlist",
		"/ws/radio",
		"//privac%79/",
		"/a.b/.../..b",
		"/health?q=%2F%5C%25%2E/../\\",
		"/health#%2f/../\\",
		"/health?next=/privacy#%252F",
	])("accepts nonstructural path %s", (path) => {
		expect(hasUnsafeRawPath(path)).toBe(false);
	});
});
