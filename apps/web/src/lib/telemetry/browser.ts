import {
	analyticsPath,
	type EventProps,
	sanitizeProps,
	type TelemetryConfig,
} from "@infinitune/shared/telemetry";
import { guardRecordingTransport } from "./recorder";

export interface Umami {
	track(
		name:
			| string
			| ((payload: Record<string, unknown>) => Record<string, unknown>),
		props?: EventProps,
	): unknown;
	getSession?(): { cache?: string };
}

declare global {
	interface Window {
		umami?: Umami;
		infinituneUmamiBeforeSend?: (
			type: string,
			payload: Record<string, unknown>,
		) => Record<string, unknown>;
	}
}

export function browserAllowed(
	config: TelemetryConfig,
	context: { dev: boolean; webdriver: boolean; hostname: string },
): boolean {
	return config.enabled && !context.dev && !context.webdriver;
}

export function createBrowserTracker(
	enabled: boolean,
	getUmami: () => Umami | undefined,
) {
	const queue: Array<[string, EventProps]> = [];
	return {
		track(name: string, props: EventProps = {}) {
			if (!enabled || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) return;
			const item: [string, EventProps] = [name, sanitizeProps(props)];
			const umami = getUmami();
			if (umami) {
				try {
					umami.track(...item);
				} catch {}
			} else if (queue.length < 50) queue.push(item);
		},
		flush() {
			const umami = getUmami();
			if (!umami) return;
			for (const item of queue.splice(0)) {
				try {
					umami.track(...item);
				} catch {}
			}
		},
	};
}

let tracker = createBrowserTracker(false, () => undefined);
let configured = false;

export function trackEvent(name: string, props: EventProps = {}): void {
	tracker.track(name, props);
}

export function startAnalytics(config: TelemetryConfig): void {
	if (configured || typeof window === "undefined") return;
	configured = true;
	if (
		!browserAllowed(config, {
			dev: import.meta.env.DEV,
			webdriver: navigator.webdriver,
			hostname: location.hostname,
		}) ||
		!config.umamiUrl ||
		!config.umamiWebsiteId ||
		!config.umamiDomains.includes(location.hostname)
	)
		return;
	tracker = createBrowserTracker(true, () => window.umami);
	window.infinituneUmamiBeforeSend = (_type, payload) => ({
		...payload,
		title: "INFINITUNE",
		url: analyticsPath(String(payload.url || "/")),
		referrer: "",
		...(payload.data
			? { data: sanitizeProps(payload.data as EventProps) }
			: {}),
	});
	const script = document.createElement("script");
	script.src = `${config.umamiUrl}/script.js`;
	script.defer = true;
	script.dataset.websiteId = config.umamiWebsiteId;
	script.dataset.domains = config.umamiDomains.join(",");
	script.dataset.excludeSearch = "true";
	script.dataset.excludeHash = "true";
	script.dataset.performance = "true";
	script.dataset.beforeSend = "infinituneUmamiBeforeSend";
	script.referrerPolicy = "no-referrer";
	script.onload = () => {
		tracker.flush();
		void startRecorder(config);
	};
	document.head.append(script);
	// This served tracker patches push/replaceState but omits popstate.
	window.addEventListener("popstate", () => {
		try {
			window.umami?.track((payload) => ({ ...payload, url: location.href }));
		} catch {}
	});
	document.addEventListener(
		"click",
		(event) => {
			const link = (
				event.target instanceof Element ? event.target.closest("a[href]") : null
			) as HTMLAnchorElement | null;
			if (
				link &&
				/^https?:$/.test(link.protocol) &&
				link.hostname !== location.hostname
			)
				trackEvent("outbound_link", { hostname: link.hostname });
		},
		{ passive: true },
	);
}

async function startRecorder(config: TelemetryConfig): Promise<void> {
	// This Umami release ignores masking attributes. Verify its server-side
	// policy before loading recorder.js; never silently accept moderate masking.
	try {
		const response = await fetch(
			`${config.umamiUrl}/api/websites/${encodeURIComponent(config.umamiWebsiteId)}/recorder`,
			{
				credentials: "omit",
				referrerPolicy: "no-referrer",
				signal: AbortSignal.timeout(2000),
			},
		);
		if (!response.ok) return;
		const policy = await response.json();
		if (
			!policy.enabled ||
			policy.maskLevel !== "strict" ||
			!policy.blockSelector?.includes("[data-telemetry-private]")
		)
			return;
		if (!policy.replayEnabled && !policy.heatmapEnabled) return;
		if (
			location.search ||
			location.hash ||
			/\/(share|auth|settings|devices)(\/|$)/.test(location.pathname)
		)
			return;
		const script = document.createElement("script");
		script.src = `${config.umamiUrl}/recorder.js`;
		guardRecordingTransport(config.umamiUrl);
		script.dataset.websiteId = config.umamiWebsiteId;
		script.referrerPolicy = "no-referrer";
		document.head.append(script);
	} catch {
		/* Analytics must never affect the player. */
	}
}
