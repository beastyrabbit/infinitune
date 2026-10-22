import { describe, expect, it, vi } from "vitest";

const { requireMainCi } = await import(
	new URL("../../../../scripts/require-main-ci.mjs", import.meta.url).href
);
const { compareVersions, verifyRollout } = await import(
	new URL("../../../../scripts/verify-rollout.mjs", import.meta.url).href
);

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);

type Run = Record<string, unknown>;
const run = (overrides: Run = {}): Run => ({
	id: 1,
	head_sha: sha,
	head_branch: "main",
	event: "push",
	status: "completed",
	conclusion: "success",
	created_at: "2026-10-22T10:00:00Z",
	html_url: "https://github.com/o/r/actions/runs/1",
	...overrides,
});

// A fake clock: sleeping advances time, so bounded waits finish instantly.
function clock() {
	let time = 0;
	return {
		now: () => time,
		sleep: vi.fn(async (ms: number) => {
			time += ms;
		}),
	};
}

function gate(responses: Array<Run[] | Response>, timeoutMs = 60_000) {
	const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
		const next = responses.length > 1 ? responses.shift() : responses[0];
		return next instanceof Response
			? next
			: Response.json({ workflow_runs: next });
	});
	const log = vi.fn();
	const result = requireMainCi({
		repository: "o/r",
		sha,
		token: "token",
		timeoutMs,
		intervalMs: 20_000,
		fetch,
		log,
		...clock(),
	});
	return { result, fetch, log };
}

describe("main CI release gate", () => {
	it("passes when the newest main push run for the SHA succeeded", async () => {
		const { result, fetch, log } = gate([[run()]]);
		await expect(result).resolves.toMatchObject({ id: 1 });
		const url = new URL(fetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/repos/o/r/actions/workflows/ci.yml/runs");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			event: "push",
			branch: "main",
			head_sha: sha,
		});
		expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
			authorization: "Bearer token",
		});
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("https://github.com/o/r/actions/runs/1"),
		);
	});

	it.each(["failure", "cancelled"])(
		"fails closed on %s",
		async (conclusion) => {
			await expect(gate([[run({ conclusion })]]).result).rejects.toThrow(
				`concluded ${conclusion}`,
			);
		},
	);

	it("fails when no run exists", async () => {
		await expect(gate([[]]).result).rejects.toThrow("No CI run");
	});

	it("ignores runs for another SHA, branch or event", async () => {
		const runs = [
			run({ head_sha: otherSha }),
			run({ head_branch: "feature" }),
			run({ event: "pull_request" }),
		];
		await expect(gate([runs]).result).rejects.toThrow("No CI run");
	});

	it("lets a newer failure override an older success", async () => {
		const runs = [
			run(),
			run({
				id: 2,
				conclusion: "failure",
				created_at: "2026-10-22T11:00:00Z",
			}),
		];
		await expect(gate([runs]).result).rejects.toThrow("concluded failure");
	});

	it("breaks creation-time ties using the newer run ID", async () => {
		await expect(
			gate([[run(), run({ id: 2, conclusion: "failure" })]]).result,
		).rejects.toThrow("concluded failure");
	});

	it("waits for an in-progress run to succeed", async () => {
		const { result, fetch } = gate([
			[run({ status: "queued", conclusion: null })],
			[run({ status: "in_progress", conclusion: null })],
			[run()],
		]);
		await expect(result).resolves.toBeTruthy();
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("accepts success when the final poll returns exactly at the deadline", async () => {
		let time = 0;
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					workflow_runs: [run({ status: "in_progress", conclusion: null })],
				}),
			)
			.mockImplementationOnce(async () => {
				time = 30_000;
				return Response.json({ workflow_runs: [run()] });
			});
		await expect(
			requireMainCi({
				repository: "o/r",
				sha,
				token: "token",
				timeoutMs: 30_000,
				intervalMs: 20_000,
				fetch,
				now: () => time,
				sleep: async (ms: number) => {
					time += ms;
				},
				log: vi.fn(),
			}),
		).resolves.toMatchObject({ id: 1 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("gives up when CI never finishes", async () => {
		const { result, fetch } = gate(
			[[run({ status: "in_progress", conclusion: null })]],
			60_000,
		);
		await expect(result).rejects.toThrow("still in_progress");
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("caps the last sleep at the CI deadline", async () => {
		const { result, fetch } = gate(
			[[run({ status: "queued", conclusion: null })]],
			1_000,
		);
		await expect(result).rejects.toThrow("still queued");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("fails closed on API errors", async () => {
		await expect(
			gate([new Response("rate limited", { status: 403 })]).result,
		).rejects.toThrow("GitHub API returned 403");
	});

	it("fails closed on network errors", async () => {
		const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
		await expect(
			requireMainCi({ repository: "o/r", sha, token: "t", fetch }),
		).rejects.toThrow("fetch failed");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("rejects anything but a full commit SHA", async () => {
		await expect(
			requireMainCi({ repository: "o/r", sha: "", token: "t" }),
		).rejects.toThrow("full commit SHA");
	});
});

type Reply = Response | Error;
function rollout(
	routes: Record<string, Reply[]>,
	options: Record<string, unknown> = {},
) {
	const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
		const replies = routes[new URL(url).pathname];
		const next = replies.length > 1 ? replies.shift() : replies[0];
		if (next instanceof Error) throw next;
		return next?.clone() as Response;
	});
	const result = verifyRollout({
		origin: "http://192.168.60.30",
		version: "1.5.0",
		reachTimeoutMs: 30_000,
		timeoutMs: 60_000,
		intervalMs: 15_000,
		fetch,
		log: vi.fn(),
		...clock(),
		...options,
	});
	return { result, fetch };
}
const version = (release: string) => Response.json({ release });
const ok = () => new Response("<html></html>", { status: 200 });

describe("post-deploy rollout check", () => {
	it("orders plain X.Y.Z releases", () => {
		expect(compareVersions("1.4.3", "1.5.0")).toBeLessThan(0);
		expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
		expect(compareVersions("1.5.0", "1.5.0")).toBe(0);
		expect(compareVersions("dev", "1.5.0")).toBeNull();
	});

	it.each(["01.5.0", "1.05.0", "1.5.00", "1.5.0-rc.1", "1.5.0+build.1"])(
		"does not compare versions outside plain X.Y.Z: %s",
		(invalid) => {
			expect(compareVersions(invalid, "1.5.0")).toBeNull();
		},
	);

	it("waits through old versions and outages until the release serves /", async () => {
		const { result, fetch } = rollout(
			{
				"/api/version": [
					new TypeError("fetch failed"),
					version("1.4.3"), // reachability probe
					version("1.4.3"),
					new Response("not found", { status: 404 }),
					new TypeError("fetch failed"),
					version("1.5.0"),
				],
				"/": [new Response("bad gateway", { status: 502 }), ok()],
			},
			{ timeoutMs: 300_000 },
		);
		await expect(result).resolves.toBeUndefined();
		const paths = fetch.mock.calls.map(([url]) => new URL(url).pathname);
		expect(paths.filter((path) => path === "/")).toHaveLength(2);
		for (const [, init] of fetch.mock.calls) {
			expect(init?.method ?? "GET").toBe("GET");
			expect(init?.redirect).toBe("manual");
		}
	});

	it("accepts a same-origin frontend redirect without following it", async () => {
		const { result, fetch } = rollout({
			"/api/version": [version("1.5.0")],
			"/": [
				new Response(null, {
					status: 307,
					headers: { location: "/autoplayer" },
				}),
			],
		});
		await expect(result).resolves.toBeUndefined();
		expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
			"/api/version",
			"/api/version",
			"/",
		]);
	});

	it("times out on an off-origin frontend redirect", async () => {
		const { result } = rollout({
			"/api/version": [version("1.5.0")],
			"/": [
				new Response(null, {
					status: 302,
					headers: { location: "https://infinitune.heerlab.com/autoplayer" },
				}),
			],
		});
		await expect(result).rejects.toThrow(
			"GET / failed after rollout: HTTP 302",
		);
	});

	it("waits through redirects from /api/version", async () => {
		const { result } = rollout({
			"/api/version": [
				version("1.4.3"),
				new Response(null, { status: 302, headers: { location: "/login" } }),
				version("1.5.0"),
			],
			"/": [ok()],
		});
		await expect(result).resolves.toBeUndefined();
	});

	it.each([
		["reachability", 1, 30_000],
		["version", 2, 60_000],
		["frontend", 3, 60_000],
	] as const)(
		"accepts a successful %s response at its deadline",
		async (_stage, finalPoll, deadline) => {
			let time = 0;
			let requests = 0;
			const { result } = rollout(
				{},
				{
					now: () => time,
					fetch: async (url: string) => {
						if (++requests === finalPoll) time = deadline;
						return new URL(url).pathname === "/" ? ok() : version("1.5.0");
					},
				},
			);
			await expect(result).resolves.toBeUndefined();
		},
	);

	it("reports superseded instead of success when a newer release runs", async () => {
		const { result } = rollout({
			"/api/version": [version("1.6.0")],
			"/": [ok()],
		});
		await expect(result).rejects.toThrow(/^Superseded: .* 1\.6\.0/);
	});

	it("times out when the release never appears", async () => {
		const { result } = rollout({
			"/api/version": [version("1.4.3")],
			"/": [ok()],
		});
		await expect(result).rejects.toThrow(
			"Timed out waiting for 1.5.0; deployment reports 1.4.3",
		);
	});

	it("waits through malformed versions and invalid JSON", async () => {
		const { result } = rollout({
			"/api/version": [
				new Response("missing", { status: 404 }), // any HTTP answer proves reachability
				version("dev"),
				new Response("not JSON"),
				version("1.5.0"),
			],
			"/": [ok()],
		});
		await expect(result).resolves.toBeUndefined();
	});

	it("fails fast when the runner cannot reach the deployment", async () => {
		const { result, fetch } = rollout({
			"/api/version": [new TypeError("connect EHOSTUNREACH")],
			"/": [ok()],
		});
		await expect(result).rejects.toThrow(
			"Runner cannot reach http://192.168.60.30: connect EHOSTUNREACH",
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("caps reachability retries at the overall deadline", async () => {
		const { result, fetch } = rollout(
			{ "/api/version": [new TypeError("fetch failed")] },
			{ timeoutMs: 1_000 },
		);
		await expect(result).rejects.toThrow("Runner cannot reach");
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("requires / to succeed after the version matches", async () => {
		const { result } = rollout({
			"/api/version": [version("1.5.0")],
			"/": [new Response("down", { status: 503 })],
		});
		await expect(result).rejects.toThrow(
			"GET / failed after rollout: HTTP 503",
		);
	});

	it("keeps frontend retries inside the overall deadline", async () => {
		const { result, fetch } = rollout(
			{
				"/api/version": [version("1.4.3"), version("1.5.0")],
				"/": [new Response("down", { status: 503 }), ok()],
			},
			{ timeoutMs: 1_000 },
		);
		await expect(result).rejects.toThrow("GET / failed after rollout");
		expect(
			fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/"),
		).toHaveLength(1);
	});

	it.each(["latest", "1.5.0-rc.1", "1.5.0+build.1", "01.5.0"])(
		"rejects a release argument outside plain X.Y.Z: %s",
		async (version) => {
			await expect(rollout({}, { version }).result).rejects.toThrow(
				"must be plain X.Y.Z",
			);
		},
	);
});
