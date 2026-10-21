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

const sensitiveKey =
	/authorization|cookie|token|password|secret|api[_-]?key|^key$|^code$|^remote[-_]|email|prompt|lyrics|^user$|^ip_address$|forwarded.for|real.ip|connecting.ip|query_string|^data$|^body$|^extra$|^vars$/i;

export function scrubString(value: string): string {
	return value
		.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
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
		})
		.replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, "$1[Filtered]@")
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[Filtered]")
		.replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[Filtered]")
		.replace(
			/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
			"[Filtered]",
		)
		.replace(
			/((?:token|key|secret|password|code|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s&;,"'}]+/gi,
			"$1[Filtered]",
		)
		.replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, "$1[Filtered]@")
		.replace(/\/(share|by-key)\/[^/?#\s]+/g, "/$1/[Filtered]");
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
			Object.entries(value).map(([key, item]) => [
				key,
				sensitiveKey.test(key)
					? typeof item === "string"
						? "[Filtered]"
						: undefined
					: scrubTelemetry(item, depth + 1),
			]),
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
