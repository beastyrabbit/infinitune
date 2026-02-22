import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/shoo", () => ({
	parseBearerToken: vi.fn(),
	verifyShooIdToken: vi.fn(),
}));

vi.mock("../services/user-service", () => ({
	upsertFromShoo: vi.fn(),
}));

import { getRequestActor, requireUserActor } from "../auth/actor";
import * as shoo from "../auth/shoo";
import * as userService from "../services/user-service";

function createContext(authorization?: string): Context {
	return {
		req: {
			header: vi.fn((name: string) =>
				name === "authorization" ? authorization : undefined,
			),
		},
	} as unknown as Context;
}

describe("auth actor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(shoo.parseBearerToken).mockImplementation((header) => {
			if (!header) return null;
			return header.replace(/^Bearer\s+/i, "");
		});
		vi.mocked(shoo.verifyShooIdToken).mockResolvedValue({
			userId: "shoo-subject-1",
			email: "person@example.com",
			name: "Person",
			picture: "https://example.com/avatar.png",
		});
		vi.mocked(userService.upsertFromShoo).mockResolvedValue({
			id: "usr_db_1",
			shooSubject: "shoo-subject-1",
			email: "person@example.com",
			displayName: "Person",
			picture: "https://example.com/avatar.png",
		} as never);
	});

	it("uses persisted user id from database for authenticated actor", async () => {
		const actor = await requireUserActor(createContext("Bearer token-1"));

		expect(actor).toEqual({
			kind: "user",
			userId: "usr_db_1",
			email: "person@example.com",
			name: "Person",
			picture: "https://example.com/avatar.png",
		});
		expect(vi.mocked(userService.upsertFromShoo)).toHaveBeenCalledWith({
			userId: "shoo-subject-1",
			email: "person@example.com",
			name: "Person",
			picture: "https://example.com/avatar.png",
		});
	});

	it("returns anonymous when bearer token is not present", async () => {
		vi.mocked(shoo.parseBearerToken).mockReturnValueOnce(null);

		const actor = await getRequestActor(createContext(undefined));

		expect(actor).toEqual({ kind: "anonymous" });
		expect(vi.mocked(shoo.verifyShooIdToken)).not.toHaveBeenCalled();
	});
});
