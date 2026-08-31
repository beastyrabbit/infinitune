// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	api,
	clearStoredShooIdToken,
	setStoredShooIdToken,
} from "../integrations/api/client";

describe("API client authentication", () => {
	afterEach(() => {
		clearStoredShooIdToken();
		vi.unstubAllGlobals();
	});

	it("adds the stored Shoo bearer token to LLM POST requests", async () => {
		setStoredShooIdToken("shoo-test-token");
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ result: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await api.post("/api/autoplayer/enhance-request", {
			request: "test",
			provider: "openrouter",
			model: "auto",
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer shoo-test-token",
		);
	});

	it("adds the stored Shoo bearer token to multipart uploads", async () => {
		setStoredShooIdToken("shoo-test-token");
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ result: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const body = new FormData();
		body.append("authFile", new Blob(["{}"]), "auth.json");

		await api.postForm("/api/autoplayer/codex-auth/upload-cache", body);

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get("authorization")).toBe("Bearer shoo-test-token");
		expect(headers.has("content-type")).toBe(false);
		expect(init.body).toBe(body);
	});
});
