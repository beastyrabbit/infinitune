import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyAutoplayerRequest } from "../lib/autoplayer-proxy";

describe("autoplayer proxy", () => {
	afterEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("forwards the user authorization header to the API", async () => {
		const upstreamFetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", upstreamFetch);

		await proxyAutoplayerRequest(
			new Request("https://music.example/api/autoplayer/openrouter-auth", {
				method: "POST",
				headers: {
					authorization: "Bearer user-test-token",
					"content-type": "application/json",
				},
				body: JSON.stringify({ apiKey: "placeholder" }),
			}),
			"/openrouter-auth",
		);

		const init = upstreamFetch.mock.calls[0]?.[1] as RequestInit;
		expect(new Headers(init.headers).get("authorization")).toBe(
			"Bearer user-test-token",
		);
	});

	it("uses the private API URL for server-side requests", async () => {
		vi.stubEnv("INTERNAL_API_URL", "http://127.0.0.1:5175");
		vi.resetModules();
		const { proxyAutoplayerRequest: proxyWithInternalUrl } = await import(
			"../lib/autoplayer-proxy"
		);
		const upstreamFetch = vi.fn().mockResolvedValue(new Response(null));
		vi.stubGlobal("fetch", upstreamFetch);

		await proxyWithInternalUrl(
			new Request(
				"https://music.example/api/autoplayer/openrouter-auth?status=1",
			),
			"/openrouter-auth",
		);

		expect(String(upstreamFetch.mock.calls[0]?.[0])).toBe(
			"http://127.0.0.1:5175/api/autoplayer/openrouter-auth?status=1",
		);
	});

	it("forwards Pangolin identity headers when proxy trust is enabled", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "true");
		const upstreamFetch = vi.fn().mockResolvedValue(new Response(null));
		vi.stubGlobal("fetch", upstreamFetch);

		await proxyAutoplayerRequest(
			new Request("https://music.example/api/autoplayer/generate-song", {
				headers: {
					"Remote-User-Id": "pangolin-user-1",
					"Remote-Email": "proxy@example.com",
					"Remote-Name": "Proxy Person",
				},
			}),
			"/generate-song",
		);

		const init = upstreamFetch.mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get("Remote-User-Id")).toBe("pangolin-user-1");
		expect(headers.get("Remote-Email")).toBe("proxy@example.com");
		expect(headers.get("Remote-Name")).toBe("Proxy Person");
	});

	it("drops Pangolin identity headers when proxy trust is disabled", async () => {
		vi.stubEnv("INFINITUNE_TRUST_PANGOLIN_HEADERS", "false");
		const upstreamFetch = vi.fn().mockResolvedValue(new Response(null));
		vi.stubGlobal("fetch", upstreamFetch);

		await proxyAutoplayerRequest(
			new Request("https://music.example/api/autoplayer/generate-song", {
				headers: {
					"Remote-User-Id": "pangolin-user-1",
					"Remote-Email": "proxy@example.com",
					"Remote-Name": "Proxy Person",
				},
			}),
			"/generate-song",
		);

		const init = upstreamFetch.mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.has("Remote-User-Id")).toBe(false);
		expect(headers.has("Remote-Email")).toBe(false);
		expect(headers.has("Remote-Name")).toBe(false);
	});
});
