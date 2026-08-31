import type { Context } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/shoo", () => ({
	parseBearerToken: vi.fn(),
	verifyShooIdToken: vi.fn(),
}));

vi.mock("../services/user-service", () => ({
	upsertFromIdentity: vi.fn(),
	upsertFromShoo: vi.fn(),
}));

import { getRequestActor, requireUserActor } from "../auth/actor";
import * as shoo from "../auth/shoo";
import * as userService from "../services/user-service";

function createContext(
	headers: Record<string, string | undefined> = {},
): Context {
	const normalizedHeaders = new Map(
		Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
	);
	return {
		req: {
			header: vi.fn((name: string) =>
				normalizedHeaders.get(name.toLowerCase()),
			),
		},
	} as unknown as Context;
}

describe("auth actor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "false");
		vi.mocked(shoo.parseBearerToken).mockImplementation((header) => {
			if (!header) return null;
			const match = /^Bearer\s+(.+)$/i.exec(header.trim());
			return match?.[1]?.trim() || null;
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
		vi.mocked(userService.upsertFromIdentity).mockResolvedValue({
			id: "usr_proxy_1",
			shooSubject: "pangolin:pangolin-user-1",
			email: "proxy@example.com",
			displayName: "Proxy Person",
			picture: null,
		} as never);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses persisted user id from database for authenticated actor", async () => {
		const actor = await requireUserActor(
			createContext({ authorization: "Bearer token-1" }),
		);

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

		const actor = await getRequestActor(createContext());

		expect(actor).toEqual({ kind: "anonymous" });
		expect(vi.mocked(shoo.verifyShooIdToken)).not.toHaveBeenCalled();
	});

	it("uses Pangolin headers only when explicitly enabled", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");

		const actor = await requireUserActor(
			createContext({
				"Remote-User-Id": "pangolin-user-1",
				"Remote-Email": "proxy@example.com",
				"Remote-Name": "Proxy Person",
			}),
		);

		expect(actor).toEqual({
			kind: "user",
			userId: "usr_proxy_1",
			email: "proxy@example.com",
			name: "Proxy Person",
			picture: undefined,
		});
		expect(vi.mocked(userService.upsertFromIdentity)).toHaveBeenCalledWith({
			subject: "pangolin:pangolin-user-1",
			email: "proxy@example.com",
			name: "Proxy Person",
		});
	});

	it("does not require optional Pangolin metadata", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");
		vi.mocked(userService.upsertFromIdentity).mockResolvedValueOnce({
			id: "usr_proxy_1",
			shooSubject: "pangolin:pangolin-user-1",
			email: null,
			displayName: null,
			picture: null,
		} as never);

		const actor = await requireUserActor(
			createContext({ "Remote-User-Id": "pangolin-user-1" }),
		);

		expect(actor?.userId).toBe("usr_proxy_1");
		expect(vi.mocked(userService.upsertFromIdentity)).toHaveBeenCalledWith({
			subject: "pangolin:pangolin-user-1",
			email: undefined,
			name: undefined,
		});
	});

	it("ignores Pangolin headers when proxy trust is disabled", async () => {
		const actor = await getRequestActor(
			createContext({ "Remote-User-Id": "pangolin-user-1" }),
		);

		expect(actor).toEqual({ kind: "anonymous" });
		expect(vi.mocked(userService.upsertFromIdentity)).not.toHaveBeenCalled();
	});

	it.each([
		["missing", undefined],
		["empty", ""],
		["whitespace", "pangolin user"],
		["surrounding whitespace", " pangolin-user-1 "],
		["unsupported characters", "pangolin/user"],
		["oversized", "a".repeat(256)],
	])("ignores a %s Pangolin user id", async (_label, userId) => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");

		const actor = await getRequestActor(
			createContext({ "Remote-User-Id": userId }),
		);

		expect(actor).toEqual({ kind: "anonymous" });
		expect(vi.mocked(userService.upsertFromIdentity)).not.toHaveBeenCalled();
	});

	it("ignores invalid optional metadata without rejecting the user id", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");

		const actor = await requireUserActor(
			createContext({
				"Remote-User-Id": "pangolin-user-1",
				"Remote-Email": "proxy\n@example.com",
				"Remote-Name": "a".repeat(256),
			}),
		);

		expect(actor?.userId).toBe("usr_proxy_1");
		expect(vi.mocked(userService.upsertFromIdentity)).toHaveBeenCalledWith({
			subject: "pangolin:pangolin-user-1",
			email: undefined,
			name: undefined,
		});
	});

	it("prefers a valid Shoo bearer over Pangolin headers", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");

		const actor = await requireUserActor(
			createContext({
				authorization: "Bearer token-1",
				"Remote-User-Id": "pangolin-user-1",
			}),
		);

		expect(actor?.userId).toBe("usr_db_1");
		expect(vi.mocked(userService.upsertFromShoo)).toHaveBeenCalledOnce();
		expect(vi.mocked(userService.upsertFromIdentity)).not.toHaveBeenCalled();
	});

	it("does not fall back to Pangolin headers after an invalid Shoo bearer", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");
		vi.mocked(shoo.verifyShooIdToken).mockRejectedValueOnce(
			new Error("invalid token"),
		);

		const actor = await getRequestActor(
			createContext({
				authorization: "Bearer invalid-token",
				"Remote-User-Id": "pangolin-user-1",
			}),
		);

		expect(actor).toEqual({ kind: "anonymous" });
		expect(vi.mocked(userService.upsertFromIdentity)).not.toHaveBeenCalled();
	});
});
