// Release gate: the commit must have a successful CI run from a push to main.
// Only the newest such run counts, so a later failure overrides an older pass.
// Usage: GITHUB_TOKEN=... node require-main-ci.mjs <owner/repo> <commit-sha>
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function requireMainCi({
	repository,
	sha,
	token,
	api = "https://api.github.com",
	timeoutMs = 30 * 60_000,
	intervalMs = 20_000,
	fetch = globalThis.fetch,
	sleep = delay,
	now = Date.now,
	log = console.log,
}) {
	if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
		throw new Error(`Expected a full commit SHA, got "${sha}"`);
	}
	const deadline = now() + timeoutMs;
	const query = new URLSearchParams({
		event: "push",
		branch: "main",
		head_sha: sha,
		per_page: "100",
	});
	const url = `${api}/repos/${repository}/actions/workflows/ci.yml/runs?${query}`;
	for (;;) {
		const response = await fetch(url, {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"x-github-api-version": "2022-11-28",
			},
			signal: AbortSignal.timeout(
				Math.max(1, Math.min(30_000, deadline - now())),
			),
		});
		if (!response.ok) {
			throw new Error(`GitHub API returned ${response.status} for CI runs`);
		}
		const { workflow_runs: runs } = await response.json();
		const [run] = (Array.isArray(runs) ? runs : [])
			.filter(
				(candidate) =>
					candidate.head_sha === sha &&
					candidate.event === "push" &&
					candidate.head_branch === "main",
			)
			.sort(
				(a, b) =>
					Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
			);
		if (!run) {
			throw new Error(`No CI run from a push to main exists for ${sha}`);
		}
		log(`Newest main CI run for ${sha}: ${run.html_url}`);
		if (now() >= deadline) {
			throw new Error(`Main CI for ${sha} is still ${run.status}; gave up`);
		}
		if (run.status === "completed") {
			if (run.conclusion === "success") return run;
			throw new Error(`Main CI for ${sha} concluded ${run.conclusion}`);
		}
		log(`Main CI is ${run.status}; waiting`);
		await sleep(Math.min(intervalMs, deadline - now()));
		if (now() >= deadline) {
			throw new Error(`Main CI for ${sha} is still ${run.status}; gave up`);
		}
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	try {
		await requireMainCi({
			repository: process.argv[2],
			sha: process.argv[3],
			token: process.env.GITHUB_TOKEN,
			api: process.env.GITHUB_API_URL || undefined,
		});
		console.log("Main CI passed for this commit");
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
