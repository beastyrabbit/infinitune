// Post-release smoke check: wait until the deployment reports the released
// version from /api/version, then require the frontend to answer at /.
// Read-only GETs only; never triggers generation or any AI provider call.
// Usage: node verify-rollout.mjs <origin> <version>
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(version) {
	return typeof version === "string" ? SEMVER.exec(version) : null;
}

// Negative when a is older than b, positive when newer, null if not semver.
export function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return null;
	for (let part = 1; part <= 3; part++) {
		const l = Number(left[part]);
		const r = Number(right[part]);
		if (l !== r) return l < r ? -1 : 1;
	}
	return 0;
}

export async function verifyRollout({
	origin,
	version,
	reachTimeoutMs = 3 * 60_000,
	timeoutMs = 20 * 60_000,
	intervalMs = 15_000,
	fetch = globalThis.fetch,
	sleep = delay,
	now = Date.now,
	log = console.log,
}) {
	if (compareVersions(version, version) !== 0) {
		throw new Error(`Release version "${version}" must be plain X.Y.Z`);
	}
	const started = now();
	const deadline = started + timeoutMs;
	const reachDeadline = Math.min(started + reachTimeoutMs, deadline);
	const get = (path) =>
		fetch(`${origin}${path}`, {
			cache: "no-store",
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
		});
	const wait = async (deadline, message) => {
		if (now() >= deadline) throw new Error(message);
		await sleep(Math.min(intervalMs, deadline - now()));
		if (now() >= deadline) throw new Error(message);
	};

	// Any HTTP answer proves the route; Recreate rollouts may briefly refuse.
	for (;;) {
		try {
			await get("/api/version");
			break;
		} catch (error) {
			log(`${origin} not reachable yet: ${error.message}`);
			await wait(
				reachDeadline,
				`Runner cannot reach ${origin}: ${error.message}`,
			);
		}
	}

	for (;;) {
		let deployed = "unavailable";
		try {
			const response = await get("/api/version");
			const body = response.ok ? await response.json() : null;
			deployed =
				typeof body?.release === "string"
					? body.release
					: `HTTP ${response.status}`;
		} catch (error) {
			deployed = error.message;
		}
		const order = compareVersions(deployed, version);
		if (order === 0) break;
		if (order > 0) {
			throw new Error(
				`Superseded: ${origin} already runs ${deployed}, newer than ${version}`,
			);
		}
		log(`Waiting for ${version}; deployment reports ${deployed}`);
		await wait(
			deadline,
			`Timed out waiting for ${version}; deployment reports ${deployed}`,
		);
	}
	log(`${origin} reports ${version}`);

	for (;;) {
		let problem;
		try {
			const response = await get("/");
			if (response.ok) break;
			const location = response.headers.get("location");
			if (
				response.status >= 300 &&
				response.status < 400 &&
				location &&
				new URL(location, origin).origin === new URL(origin).origin
			) {
				break;
			}
			problem = `HTTP ${response.status}`;
		} catch (error) {
			problem = error.message;
		}
		log(`GET / not healthy yet: ${problem}`);
		await wait(deadline, `GET / failed after rollout: ${problem}`);
	}
	log(`GET ${origin}/ succeeded`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	try {
		await verifyRollout({ origin: process.argv[2], version: process.argv[3] });
		console.log(`Rollout of ${process.argv[3]} verified`);
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
