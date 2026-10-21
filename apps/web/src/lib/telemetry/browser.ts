import {
	analyticsPath,
	type EventProps,
	sanitizeProps,
	type TelemetryConfig,
} from "@infinitune/shared/telemetry";

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
		url: analyticsPath(typeof payload.url === "string" ? payload.url : "/"),
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
