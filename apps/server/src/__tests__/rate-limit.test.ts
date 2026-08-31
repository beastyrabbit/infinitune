import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn() },
}));

import { logger } from "../logger";
import { withGlobalCap } from "../middleware/limiters";
import {
	createRateLimiter,
	getRateLimitBucketCount,
	resetRateLimiters,
} from "../middleware/rate-limit";

function buildApp(limit: number, windowMs: number) {
	const app = new Hono();
	app.use("/limited", createRateLimiter({ limit, windowMs, prefix: "test" }));
	app.get("/limited", (c) => c.json({ ok: true }));
	app.get("/other", (c) => c.json({ ok: true }));
	return app;
}

const nodeEnv = (remoteAddress: string) => ({
	incoming: {
		socket: {
			remoteAddress,
			remotePort: 1234,
			remoteFamily: "IPv4",
		},
	},
});

describe("rate-limit middleware", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		vi.mocked(logger.error).mockClear();
		vi.mocked(logger.warn).mockClear();
		resetRateLimiters();
	});

	afterEach(() => {
		resetRateLimiters();
		vi.useRealTimers();
	});

	it("allows requests up to the limit", async () => {
		const app = buildApp(3, 60_000);
		for (let i = 0; i < 3; i++) {
			const res = await app.request("/limited");
			expect(res.status).toBe(200);
		}
	});

	it("returns 429 with retry-after once exhausted", async () => {
		const app = buildApp(2, 60_000);
		await app.request("/limited");
		await app.request("/limited");
		const res = await app.request("/limited");
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("30");
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Too many requests");
	});

	it("does not limit other paths", async () => {
		const app = buildApp(1, 60_000);
		await app.request("/limited");
		const res = await app.request("/other");
		expect(res.status).toBe(200);
	});

	it("keys buckets per client", async () => {
		const app = new Hono();
		app.use(
			"/",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "keyed",
				keyBy: (c) => c.req.header("x-test-client") ?? "unknown",
			}),
		);
		app.get("/", (c) => c.json({ ok: true }));

		const firstRes = await app.request("/", {
			headers: { "x-test-client": "a" },
		});
		const secondResSameClient = await app.request("/", {
			headers: { "x-test-client": "a" },
		});
		const otherClientRes = await app.request("/", {
			headers: { "x-test-client": "b" },
		});
		expect(firstRes.status).toBe(200);
		expect(secondResSameClient.status).toBe(429);
		expect(otherClientRes.status).toBe(200);
	});

	it("preserves a global-cap response across different client buckets", async () => {
		const app = new Hono();
		app.use(
			"/",
			withGlobalCap(
				createRateLimiter({
					limit: 2,
					windowMs: 60_000,
					prefix: "paired-client",
					keyBy: (c) => c.req.header("x-test-client") ?? "unknown",
				}),
				createRateLimiter({
					limit: 1,
					windowMs: 60_000,
					prefix: "paired-global",
					keyBy: () => "all-clients",
					maxBuckets: 1,
				}),
			),
		);
		app.get("/", (c) => c.json({ ok: true }));

		expect(
			(await app.request("/", { headers: { "x-test-client": "a" } })).status,
		).toBe(200);
		const globallyLimited = await app.request("/", {
			headers: { "x-test-client": "b" },
		});
		expect(globallyLimited.status).toBe(429);
		expect(await globallyLimited.json()).toEqual({
			error: "Too many requests",
		});
	});

	it("ignores proxy headers from an untrusted or missing socket peer", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "missing-socket",
				trustedProxyIps: ["192.0.2.10"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));
		const first = await app.request("/limited", {
			headers: { "x-forwarded-for": "203.0.113.1, 192.0.2.10" },
		});
		const spoofedFirstHop = await app.request("/limited", {
			headers: { "x-forwarded-for": "203.0.113.2, 192.0.2.10" },
		});

		expect(first.status).toBe(200);
		expect(spoofedFirstHop.status).toBe(429);
	});

	it("uses the first untrusted hop from the right of a trusted proxy chain", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "trusted-proxy",
				trustedProxyIps: ["192.0.2.10"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.1, 192.0.2.9" } },
			nodeEnv("192.0.2.10"),
		);
		const spoofedFirstHop = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.2, 198.51.100.7" } },
			nodeEnv("192.0.2.10"),
		);
		const otherClient = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "198.51.100.8" } },
			nodeEnv("192.0.2.10"),
		);

		expect(first.status).toBe(200);
		expect(spoofedFirstHop.status).toBe(200);
		expect(otherClient.status).toBe(200);
	});

	it("accepts CIDR trust ranges and skips multiple trusted hops", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "trusted-cidr",
				trustedProxyIps: ["10.0.0.0/8", "192.0.2.0/24"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.1, 192.0.2.8" } },
			nodeEnv("10.10.0.5"),
		);
		const sameClientViaAnotherProxy = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.1, 192.0.2.9" } },
			nodeEnv("10.10.0.6"),
		);
		const otherClient = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.2, 192.0.2.9" } },
			nodeEnv("10.10.0.6"),
		);

		expect(first.status).toBe(200);
		expect(sameClientViaAnotherProxy.status).toBe(429);
		expect(otherClient.status).toBe(200);
	});

	it("stops at an untrusted hop so a spoofed prefix cannot select a bucket", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "spoof-resistant",
				trustedProxyIps: ["192.0.2.0/24"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.1, 198.51.100.7" } },
			nodeEnv("192.0.2.10"),
		);
		const spoofedPrefix = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.2, 198.51.100.7" } },
			nodeEnv("192.0.2.10"),
		);

		expect(first.status).toBe(200);
		expect(spoofedPrefix.status).toBe(429);
	});

	it("uses the appended direct peer when a client forges the earlier chain", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "frontend-chain",
				trustedProxyIps: ["10.42.0.0/16"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{
				headers: {
					"x-forwarded-for": "198.51.100.1, 203.0.113.8",
				},
			},
			nodeEnv("10.42.0.25"),
		);
		const forgedPrefix = await app.request(
			"/limited",
			{
				headers: {
					"x-forwarded-for": "198.51.100.2, 203.0.113.8",
				},
			},
			nodeEnv("10.42.0.25"),
		);

		expect(first.status).toBe(200);
		expect(forgedPrefix.status).toBe(429);
	});

	it("trusts a forwarded client only from the configured frontend proxy", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "configured-frontend",
				trustedProxyIps: ["10.42.0.25"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const trustedFrontend = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.8" } },
			nodeEnv("10.42.0.25"),
		);
		const untrustedFrontend = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.8" } },
			nodeEnv("10.42.0.26"),
		);
		const sameUntrustedFrontend = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "203.0.113.9" } },
			nodeEnv("10.42.0.26"),
		);

		expect(trustedFrontend.status).toBe(200);
		expect(untrustedFrontend.status).toBe(200);
		expect(sameUntrustedFrontend.status).toBe(429);
	});

	it("groups IPv6 clients by /64 so address rotation does not reset limits", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "ipv6" }),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			undefined,
			nodeEnv("2001:db8:1234:5678::1"),
		);
		const rotated = await app.request(
			"/limited",
			undefined,
			nodeEnv("2001:db8:1234:5678:ffff::2"),
		);
		const otherNetwork = await app.request(
			"/limited",
			undefined,
			nodeEnv("2001:db8:1234:5679::1"),
		);

		expect(first.status).toBe(200);
		expect(rotated.status).toBe(429);
		expect(otherNetwork.status).toBe(200);
	});

	it("falls back to the socket peer for an invalid forwarded chain", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "invalid-forwarded",
				trustedProxyIps: ["192.0.2.10"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "not-an-ip" } },
			nodeEnv("192.0.2.10"),
		);
		const second = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "still-not-an-ip" } },
			nodeEnv("192.0.2.10"),
		);

		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it("uses a valid client hop before an unrelated malformed prefix", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "partly-valid-forwarded",
				trustedProxyIps: ["192.0.2.0/24"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "bad-prefix, 203.0.113.1" } },
			nodeEnv("192.0.2.10"),
		);
		const sameClient = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "other-bad-prefix, 203.0.113.1" } },
			nodeEnv("192.0.2.10"),
		);
		const otherClient = await app.request(
			"/limited",
			{ headers: { "x-forwarded-for": "bad-prefix, 203.0.113.2" } },
			nodeEnv("192.0.2.10"),
		);

		expect(first.status).toBe(200);
		expect(sameClient.status).toBe(429);
		expect(otherClient.status).toBe(200);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("does not use X-Real-IP as a fallback", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "no-real-ip",
				trustedProxyIps: ["192.0.2.10"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		const first = await app.request(
			"/limited",
			{ headers: { "x-real-ip": "203.0.113.1" } },
			nodeEnv("192.0.2.10"),
		);
		const changedHeader = await app.request(
			"/limited",
			{ headers: { "x-real-ip": "203.0.113.2" } },
			nodeEnv("192.0.2.10"),
		);

		expect(first.status).toBe(200);
		expect(changedHeader.status).toBe(429);
	});

	it("fails closed when forwarded headers lack a trust configuration", async () => {
		const app = buildApp(5, 60_000);
		const first = await app.request("/limited", {
			headers: { "x-forwarded-for": "203.0.113.1" },
		});
		const second = await app.request("/limited", {
			headers: { "x-forwarded-for": "203.0.113.2" },
		});

		expect(first.status).toBe(503);
		expect(second.status).toBe(503);
		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "missing-trust-config" }),
			"Refusing forwarded request without trusted proxy configuration",
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("warns once when the socket peer is outside the configured ranges", async () => {
		const app = new Hono();
		app.use(
			"/limited",
			createRateLimiter({
				limit: 5,
				windowMs: 60_000,
				prefix: "untrusted-warning",
				trustedProxyIps: ["10.0.0.0/8"],
			}),
		);
		app.get("/limited", (c) => c.json({ ok: true }));

		for (const client of ["203.0.113.1", "203.0.113.2"]) {
			await app.request(
				"/limited",
				{ headers: { "x-forwarded-for": client } },
				nodeEnv("192.0.2.10"),
			);
		}

		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "untrusted-peer" }),
			"Ignoring X-Forwarded-For for rate limiting",
		);
	});

	it("uses the socket peer when proxy headers are absent", async () => {
		const app = buildApp(1, 60_000);
		const first = await app.request(
			"/limited",
			undefined,
			nodeEnv("192.0.2.10"),
		);
		const sameClient = await app.request(
			"/limited",
			undefined,
			nodeEnv("192.0.2.10"),
		);
		const otherClient = await app.request(
			"/limited",
			undefined,
			nodeEnv("192.0.2.11"),
		);

		expect(first.status).toBe(200);
		expect(sameClient.status).toBe(429);
		expect(otherClient.status).toBe(200);
	});

	it("evicts the least recently used bucket instead of sharing overflow", async () => {
		const app = new Hono();
		app.use(
			"/",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "bounded",
				maxBuckets: 2,
				keyBy: (c) => c.req.header("x-test-client") ?? "unknown",
			}),
		);
		app.get("/", (c) => c.json({ ok: true }));

		expect(
			(
				await app.request("/", {
					headers: { "x-test-client": "first" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await app.request("/", {
					headers: { "x-test-client": "second" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await app.request("/", {
					headers: { "x-test-client": "third" },
				})
			).status,
		).toBe(200);
		expect(
			(
				await app.request("/", {
					headers: { "x-test-client": "third" },
				})
			).status,
		).toBe(429);
		expect(
			(
				await app.request("/", {
					headers: { "x-test-client": "first" },
				})
			).status,
		).toBe(200);
		expect(getRateLimitBucketCount()).toBe(2);
	});

	it("stays bounded and does not throttle an honest client through key churn", async () => {
		const app = new Hono();
		app.use(
			"/",
			createRateLimiter({
				limit: 1,
				windowMs: 60_000,
				prefix: "churn",
				maxBuckets: 3,
				keyBy: (c) => c.req.header("x-test-client") ?? "unknown",
			}),
		);
		app.get("/", (c) => c.json({ ok: true }));

		expect(
			(await app.request("/", { headers: { "x-test-client": "honest" } }))
				.status,
		).toBe(200);
		for (let index = 0; index < 50; index++) {
			expect(
				(
					await app.request("/", {
						headers: { "x-test-client": `rotating-${index}` },
					})
				).status,
			).toBe(200);
			expect(getRateLimitBucketCount()).toBeLessThanOrEqual(3);
		}

		// Churn may evict idle history, but it cannot force an honest request into
		// an attacker-drained shared overflow bucket.
		expect(
			(await app.request("/", { headers: { "x-test-client": "honest" } }))
				.status,
		).toBe(200);
	});

	it("refills tokens as the window elapses", async () => {
		const app = buildApp(1, 200);
		await app.request("/limited");
		const limitedRes = await app.request("/limited");
		expect(limitedRes.status).toBe(429);

		await vi.advanceTimersByTimeAsync(220);
		const refilledRes = await app.request("/limited");
		expect(refilledRes.status).toBe(200);
	});

	it("can reuse a limiter after its test state is reset", async () => {
		const app = buildApp(1, 60_000);
		expect((await app.request("/limited")).status).toBe(200);
		expect((await app.request("/limited")).status).toBe(429);

		resetRateLimiters();

		expect((await app.request("/limited")).status).toBe(200);
	});
});
