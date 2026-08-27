import { describe, expect, it } from "vitest";
import {
	findReusablePermanentShareLink,
	type ShareLinkResponse,
} from "../lib/share-links";

function link(
	id: string,
	expiresAt: number | null,
	revokedAt: number | null = null,
): ShareLinkResponse {
	return { id, token: `${id}-token`, expiresAt, revokedAt };
}

describe("permanent share-link reuse", () => {
	it("does not present a timed link as permanent", () => {
		expect(
			findReusablePermanentShareLink([
				link("timed", Date.now() + 60_000),
				link("revoked-permanent", null, Date.now()),
			]),
		).toBeUndefined();
	});

	it("reuses a live permanent link", () => {
		const permanent = link("permanent", null);
		expect(
			findReusablePermanentShareLink([
				link("timed", Date.now() + 60_000),
				permanent,
			]),
		).toBe(permanent);
	});
});
