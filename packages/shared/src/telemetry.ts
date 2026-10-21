/** Public configuration only. Never serialize process.env itself. */
export interface TelemetryConfig {
	umamiUrl: string;
	umamiWebsiteId: string;
	umamiDomains: string[];
	dsn: string;
	environment: string;
	release: string;
	tracesSampleRate: number;
	enabled: boolean;
}

export function httpUrl(value = ""): string {
	try {
		const url = new URL(value);
		return /^https?:$/.test(url.protocol) && !url.username && !url.password
			? url.origin
			: "";
	} catch {
		return "";
	}
}

export function telemetryConfig(
	env: Record<string, string | undefined>,
): TelemetryConfig {
	const rate = Number(env.GLITCHTIP_TRACES_SAMPLE_RATE ?? "0.1");
	const production = env.NODE_ENV === "production";
	return {
		umamiUrl: httpUrl(env.UMAMI_URL),
		umamiWebsiteId: env.UMAMI_WEBSITE_ID?.trim() ?? "",
		umamiDomains: (env.UMAMI_DOMAINS ?? "")
			.split(",")
			.map((domain) => domain.trim())
			.filter(Boolean),
		dsn: env.GLITCHTIP_DSN?.trim() ?? "",
		environment:
			env.TELEMETRY_ENVIRONMENT || (production ? "production" : "development"),
		release: env.INFINITUNE_RELEASE || "dev",
		tracesSampleRate:
			Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.1,
		enabled:
			env.NODE_ENV !== "test" &&
			env.VITEST !== "true" &&
			(production || env.TELEMETRY_ENABLED === "true"),
	};
}

const sensitiveKeyPatterns = [
	/authorization|cookie|token|password|secret|api[_-]?key|email|prompt|lyrics|query_string/i,
	/^(key|code|user|ip_address|data|body|extra|vars)$/i,
	/^remote[-_]|forwarded.for|real.ip|connecting.ip/i,
];

function isSensitiveKey(key: string): boolean {
	return sensitiveKeyPatterns.some((pattern) => pattern.test(key));
}

function scrubUserinfo(value: string): string {
	// Scan each authority once. Colons may also occur inside either credential.
	return value.replace(
		/(https?:\/\/)([^/\s@]+)@/gi,
		(raw, protocol: string, authority: string) => {
			const colon = authority.indexOf(":", 1);
			return colon > 0 && colon < authority.length - 1
				? `${protocol}[Filtered]@`
				: raw;
		},
	);
}

function emailDomainEnd(value: string, start: number): number {
	const domains = /[A-Z0-9.-]+/iy;
	domains.lastIndex = start;
	const domain = domains.exec(value);
	if (!domain) return 0;
	// Preserve the original match's last dot followed by at least two letters,
	// including partial domains such as user@example.com.123.
	let end = 0;
	for (const suffix of domain[0].matchAll(/\.[A-Z]{2,}/gi)) {
		if (suffix.index > 0) {
			end = domain.index + suffix.index + suffix[0].length;
		}
	}
	return end;
}

function scrubEmails(value: string): string {
	const localParts = /[A-Z0-9._%+-]+/gi;
	let result = "";
	let cursor = 0;
	while (true) {
		const local = localParts.exec(value);
		if (!local) break;
		if (value[localParts.lastIndex] === "@") {
			const end = emailDomainEnd(value, localParts.lastIndex + 1);
			if (end) {
				result += `${value.slice(cursor, local.index)}[Filtered]`;
				cursor = end;
				localParts.lastIndex = end;
			}
		}
	}
	return result + value.slice(cursor);
}

export function scrubString(value: string): string {
	const urls = value.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
		try {
			const url = new URL(raw);
			url.username = "";
			url.password = "";
			url.search = "";
			url.hash = "";
			return url.toString();
		} catch {
			return "[Filtered URL]";
		}
	});
	const secrets = scrubEmails(scrubUserinfo(urls))
		.replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[Filtered]")
		.replace(
			/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
			"[Filtered]",
		)
		.replace(
			/((?:token|key|secret|password|code|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s&;,"'}]+/gi,
			"$1[Filtered]",
		);
	return scrubUserinfo(secrets).replace(
		/\/(share|by-key)\/[^/?#\s]+/g,
		"/$1/[Filtered]",
	);
}

/** Keep the SDK's typed shape while walking nested request/context/breadcrumb values. */
export function scrubTelemetry<T>(value: T, depth = 0): T {
	if (depth > 12) return "[Filtered]" as T;
	if (typeof value === "string") return scrubString(value) as T;
	if (Array.isArray(value))
		return value
			.slice(0, 100)
			.map((item) => scrubTelemetry(item, depth + 1)) as T;
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => {
				if (isSensitiveKey(key)) {
					return [key, typeof item === "string" ? "[Filtered]" : undefined];
				}
				return [key, scrubTelemetry(item, depth + 1)];
			}),
		) as T;
	}
	return value;
}

export type EventProps = Record<string, string | number | boolean | undefined>;
// Allowlist prevents accidental prompt/lyrics/identity data from new callers.
const propertyKeys = new Set([
	"song_id",
	"playlist_id",
	"provider",
	"model",
	"stage",
	"duration_ms",
	"error_class",
	"role",
	"rating",
	"mode",
	"prompt_length",
	"is_interrupt",
	"status",
	"setting",
	"hostname",
	"epoch",
	"source",
	"action",
	"kind",
]);
export function sanitizeProps(props: EventProps = {}): EventProps {
	return Object.fromEntries(
		Object.entries(props)
			.filter(
				([key, value]) =>
					propertyKeys.has(key) &&
					(typeof value === "string" ||
						typeof value === "boolean" ||
						(typeof value === "number" && Number.isFinite(value))),
			)
			.slice(0, 20)
			.map(([key, value]) => [
				key,
				typeof value === "string" ? scrubString(value).slice(0, 120) : value,
			]),
	);
}

/** Analytics URLs never contain queries, fragments, or bearer share links. */
export function analyticsPath(raw: string): string {
	try {
		const url = new URL(raw, "https://local.invalid");
		return url.pathname.replace(/\/(share|by-key)\/[^/]+/g, "/$1/:redacted");
	} catch {
		return "/";
	}
}

export function shouldTraceRequest(pathname: string, userAgent = ""): boolean {
	return pathname !== "/health" && !/kube-probe\//i.test(userAgent);
}
