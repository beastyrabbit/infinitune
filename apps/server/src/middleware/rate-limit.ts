import { BlockList, isIP } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Next } from "hono";
import { logger } from "../logger";

export interface RateLimitOptions {
	/** Max requests allowed per window. */
	limit: number;
	/** Window length in milliseconds. */
	windowMs: number;
	/**
	 * Optional key prefix so multiple limiters don't share buckets.
	 * Defaults to the route path.
	 */
	prefix?: string;
	/** Extract a client key; defaults to a trusted proxy header or socket peer. */
	keyBy?: (c: Context) => string;
	/** Socket peer IPs or CIDRs allowed to supply X-Forwarded-For. */
	trustedProxyIps?: readonly string[];
	/** Maximum live client buckets. Least-recently-used buckets are evicted. */
	maxBuckets?: number;
}

interface Bucket {
	tokens: number;
	lastRefill: number;
}

interface RateLimitStore {
	buckets: Map<string, Bucket>;
	timer: ReturnType<typeof setInterval> | null;
}

const stores = new Set<RateLimitStore>();
const proxyHeaderWarnings = new Set<string>();

function sweep(store: RateLimitStore): void {
	const now = Date.now();
	for (const [key, bucket] of store.buckets) {
		if (now - bucket.lastRefill > 10 * 60_000) store.buckets.delete(key);
	}
}

function ensureTimer(store: RateLimitStore): void {
	if (store.timer) return;
	store.timer = setInterval(() => sweep(store), 60_000);
	store.timer.unref?.();
}

function normalizeIp(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	const normalized = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
	return isIP(normalized) ? normalized : undefined;
}

function ipv6NetworkKey(address: string): string {
	const halves = address.toLowerCase().split("::");
	if (halves.length > 2) return address;
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves[1] ? halves[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if (missing < 0) return address;
	const expanded = [
		...left,
		...Array.from({ length: missing }, () => "0"),
		...right,
	];
	if (expanded.length !== 8) return address;
	return `${expanded
		.slice(0, 4)
		.map((part) => Number.parseInt(part || "0", 16).toString(16))
		.join(":")}::/64`;
}

function clientBucketKey(address: string): string {
	return isIP(address) === 6 ? ipv6NetworkKey(address) : address;
}

function configuredTrustedProxyIps(): string[] {
	return (process.env.RATE_LIMIT_TRUSTED_PROXY_IPS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

interface TrustedProxyMatcher {
	configured: boolean;
	matches: (address: string) => boolean;
}

function createTrustedProxyMatcher(
	entries: readonly string[],
): TrustedProxyMatcher {
	const blockList = new BlockList();
	let configured = false;

	for (const entry of entries) {
		const parts = entry.trim().split("/");
		if (parts.length > 2) continue;
		const address = normalizeIp(parts[0]);
		if (!address) continue;
		const version = isIP(address);

		try {
			if (parts.length === 1) {
				blockList.addAddress(address, version === 6 ? "ipv6" : "ipv4");
			} else {
				const prefix = Number(parts[1]);
				const maxPrefix = version === 6 ? 128 : 32;
				if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
					continue;
				}
				blockList.addSubnet(address, prefix, version === 6 ? "ipv6" : "ipv4");
			}
			configured = true;
		} catch {
			// Ignore malformed subnet bases and continue with valid entries.
		}
	}

	return {
		configured,
		matches: (address) => {
			const version = isIP(address);
			return (
				version !== 0 &&
				blockList.check(address, version === 6 ? "ipv6" : "ipv4")
			);
		},
	};
}

/**
 * Whether the request's direct socket peer belongs to the configured proxy
 * allowlist. Identity headers must never be trusted merely because they are
 * present: only an allowed reverse proxy may assert them.
 */
export function isTrustedProxyPeer(c: Context): boolean {
	const trustedProxies = createTrustedProxyMatcher(configuredTrustedProxyIps());
	if (!trustedProxies.configured) return false;

	try {
		const remoteAddress = normalizeIp(getConnInfo(c).remote.address);
		return Boolean(remoteAddress && trustedProxies.matches(remoteAddress));
	} catch {
		// Hono's in-process request helper has no Node socket binding. Production
		// identity checks must fail closed when the direct peer is unavailable.
		return false;
	}
}

function warnIgnoredProxyHeader(
	reason: "untrusted-peer" | "invalid-header",
	remoteAddress: string | undefined,
): void {
	if (proxyHeaderWarnings.has(reason)) return;
	proxyHeaderWarnings.add(reason);
	logger.warn(
		{ reason, remoteAddress },
		"Ignoring X-Forwarded-For for rate limiting",
	);
}

function logMissingProxyTrustConfiguration(
	remoteAddress: string | undefined,
): void {
	const reason = "missing-trust-config";
	if (proxyHeaderWarnings.has(reason)) return;
	proxyHeaderWarnings.add(reason);
	logger.error(
		{ reason, remoteAddress },
		"Refusing forwarded request without trusted proxy configuration",
	);
}

function defaultKey(
	c: Context,
	trustedProxies: TrustedProxyMatcher,
): string | null {
	let remoteAddress: string | undefined;
	try {
		remoteAddress = normalizeIp(getConnInfo(c).remote.address);
	} catch {
		// Hono's in-process test/request helper has no Node socket binding.
	}
	const forwardedFor = c.req.header("x-forwarded-for")?.trim();
	if (!forwardedFor)
		return remoteAddress ? clientBucketKey(remoteAddress) : "local";
	if (!trustedProxies.configured) {
		logMissingProxyTrustConfiguration(remoteAddress);
		return null;
	}
	if (!remoteAddress || !trustedProxies.matches(remoteAddress)) {
		warnIgnoredProxyHeader("untrusted-peer", remoteAddress);
		return remoteAddress ? clientBucketKey(remoteAddress) : "local";
	}

	const forwardedHops = forwardedFor.split(",");
	for (let index = forwardedHops.length - 1; index >= 0; index--) {
		const hop = normalizeIp(forwardedHops[index]);
		if (!hop) {
			warnIgnoredProxyHeader("invalid-header", remoteAddress);
			return `${clientBucketKey(remoteAddress)}:invalid-forwarded`;
		}
		if (!trustedProxies.matches(hop)) return clientBucketKey(hop);
	}
	return clientBucketKey(remoteAddress);
}

/**
 * In-memory token-bucket rate limiter.
 * Buckets refill continuously at `limit / windowMs` tokens per ms,
 * starting full — short bursts are tolerated up to the bucket capacity.
 */
export function createRateLimiter(options: RateLimitOptions) {
	const trustedProxies = createTrustedProxyMatcher(
		options.trustedProxyIps ?? configuredTrustedProxyIps(),
	);
	const refillPerMs = options.limit / options.windowMs;
	const maxBuckets = Math.max(1, Math.floor(options.maxBuckets ?? 10_000));
	const store: RateLimitStore = {
		buckets: new Map(),
		timer: null,
	};
	stores.add(store);
	ensureTimer(store);

	return async function rateLimiter(c: Context, next: Next) {
		stores.add(store);
		ensureTimer(store);
		const prefix = options.prefix ?? c.req.path;
		const clientKey = options.keyBy
			? options.keyBy(c)
			: defaultKey(c, trustedProxies);
		if (clientKey === null) {
			return c.json({ error: "Service unavailable" }, 503);
		}
		const key = `${prefix}:${clientKey}`;
		if (!store.buckets.has(key) && store.buckets.size >= maxBuckets) {
			const oldestKey = store.buckets.keys().next().value;
			if (oldestKey !== undefined) store.buckets.delete(oldestKey);
		}
		const now = Date.now();
		let bucket = store.buckets.get(key);
		if (!bucket) {
			bucket = { tokens: options.limit, lastRefill: now };
			store.buckets.set(key, bucket);
		}
		bucket.tokens = Math.min(
			options.limit,
			bucket.tokens + (now - bucket.lastRefill) * refillPerMs,
		);
		bucket.lastRefill = now;
		store.buckets.delete(key);
		store.buckets.set(key, bucket);

		if (bucket.tokens < 1) {
			const missingTokens = 1 - bucket.tokens;
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil(missingTokens / refillPerMs / 1000),
			);
			c.header("retry-after", String(retryAfterSeconds));
			return c.json({ error: "Too many requests" }, 429);
		}
		bucket.tokens -= 1;
		await next();
	};
}

/** Release all buckets for a limiter (used by tests). */
export function resetRateLimiters(): void {
	for (const store of stores) {
		if (store.timer) clearInterval(store.timer);
		store.timer = null;
		store.buckets.clear();
		stores.delete(store);
	}
	proxyHeaderWarnings.clear();
}

/** Current bucket count across live limiter instances (diagnostic for tests). */
export function getRateLimitBucketCount(): number {
	let count = 0;
	for (const store of stores) count += store.buckets.size;
	return count;
}
