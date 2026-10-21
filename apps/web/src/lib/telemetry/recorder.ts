import { analyticsPath } from "@infinitune/shared/telemetry";

/** A second privacy boundary for rrweb attributes, URLs and heatmaps.
 * Strict masking covers text/input content, but rrweb also serializes DOM
 * attributes and the recorder puts full URLs in heatmap events.
 */
export function sanitizeRecording(value: unknown, key = ""): unknown {
	if (typeof value === "string") {
		if (/^(textContent|text|value|title|alt|placeholder)$/.test(key))
			return "[Masked]";
		if (/^(url|href|src)$/.test(key)) {
			try {
				const url = new URL(value, location.origin);
				if (url.protocol !== "http:" && url.protocol !== "https:") return "";
				return `${url.origin}${analyticsPath(url.href)}`;
			} catch {
				return "";
			}
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((item) => sanitizeRecording(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([name, item]) => [
				name,
				name === "attributes" && item && typeof item === "object"
					? Object.fromEntries(
							Object.entries(item)
								.filter(([attribute]) =>
									/^(class|style|type|width|height|rel|href|src)$/.test(
										attribute,
									),
								)
								.map(([attribute, content]) => [
									attribute,
									sanitizeRecording(content, attribute),
								]),
						)
					: sanitizeRecording(item, name),
			]),
		);
	}
	return value;
}

export function guardRecordingTransport(host: string): void {
	const originalFetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		let rawUrl: string;
		if (typeof input === "string") rawUrl = input;
		else if (input instanceof URL) rawUrl = input.href;
		else rawUrl = input.url;
		const url = new URL(rawUrl, location.href);
		if (url.href !== `${host}/api/record`) return originalFetch(input, init);
		try {
			if (typeof init?.body !== "string")
				return new Response("", { status: 202 });
			// Oversized snapshot fragments cannot be inspected independently.
			if (init.body.includes("umami:rrweb-event-fragment"))
				return new Response("", { status: 202 });
			const body = JSON.stringify(sanitizeRecording(JSON.parse(init.body)));
			return originalFetch(input, {
				...init,
				body,
				credentials: "omit",
				referrerPolicy: "no-referrer",
			});
		} catch {
			return new Response("", { status: 202 });
		}
	};
}
