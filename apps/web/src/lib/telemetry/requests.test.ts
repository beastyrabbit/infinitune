import { beforeEach, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
	initNodeTelemetry: vi.fn(),
	captureError: vi.fn(),
	withTelemetrySpan: vi.fn(
		(_name: string, _op: string, callback: () => unknown) => callback(),
	),
	updateTelemetrySpanName: vi.fn(),
	render: vi.fn(() => new Response("page")),
}));
vi.mock("@infinitune/shared/telemetry-node", () => telemetry);
vi.mock("@tanstack/react-start/server", () => ({
	createStartHandler:
		(handler: (context: unknown) => unknown) => (request: Request) =>
			handler({
				request,
				router: {
					state: { matches: [{ routeId: "/playlist/$id", status: "success" }] },
					routesById: { "/playlist/$id": { fullPath: "/playlist/$id" } },
				},
			}),
	defaultStreamHandler: telemetry.render,
}));

import server, { createServerEntry } from "../../server";
import { legalDocuments, renderLegalPage } from "../legal/pages.server";

beforeEach(() => vi.clearAllMocks());

const bypasses = [
	"/_serverFn/ID/a%5Cb%2F..%2F..%2F..%2Fprivacy",
	"/_serverFn/ID/a%25252Fb%2F..%2F..%2F..%2Fprivacy",
	"/a%5Cb%2F..%2Fprivacy",
];

// Preserve the wire path, including segments WHATWG Request.url normalizes.
function rawRequest(path: string, method = "GET", nodeRuntime = true): Request {
	const request = new Request(`http://localhost${path}`, { method });
	if (nodeRuntime) {
		Object.assign(request, { runtime: { node: { req: { url: path } } } });
	} else {
		Object.defineProperty(request, "url", { value: `http://localhost${path}` });
	}
	return request;
}

it.each([
	...bypasses,
	"/a%2Fb/privacy",
	"/a%2fb/privacy",
	"/a%5Cb/privacy",
	"/a%5cb/privacy",
	"/a%25b/privacy",
	"/a%2Eb/privacy",
	"/a%2eb/privacy",
	"/a%252Fb/privacy",
	"/a%25252Fb/privacy",
	"/a%255Cb/privacy",
	"/a%252e%252e/privacy",
	"/a\\b/privacy",
	"/./privacy",
	"/../privacy",
	"/a/./privacy",
	"/a/../privacy",
	"/privacy/.",
	"/privacy/..",
	"/_serverFn/x/a%2F..%2F..%2F..%2Fprivacy/../privacy",
])("rejects raw path %s before legal or app dispatch", async (path) => {
	const fetch = vi.fn(async () => new Response("app handler"));
	const entry = createServerEntry({ fetch });
	for (const nodeRuntime of [true, false]) {
		for (const method of ["GET", "HEAD", "POST"]) {
			const response = await entry.fetch(rawRequest(path, method, nodeRuntime));
			expect(response.status).toBe(400);
			expect(response.headers.get("Content-Type")).toBe(
				"text/plain; charset=utf-8",
			);
			expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(await response.text()).toBe("Bad Request");
		}
	}
	expect(fetch).not.toHaveBeenCalled();
	expect(telemetry.render).not.toHaveBeenCalled();
	expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
});

it.each([
	["/privacy", "/privacy"],
	["/privacy/", "/privacy"],
	["//privacy", "/privacy"],
	["/privac%79", "/privacy"],
	["/impressum", "/impressum"],
	["/datenschutz", "/datenschutz"],
	["/legal-notice", "/legal-notice"],
	["/privacy?u=a%2Fb#ignored%25", "/privacy"],
])("serves benign legal path %s without app dispatch", async (path, legal) => {
	const fetch = vi.fn(async () => new Response("app handler"));
	const entry = createServerEntry({ fetch });
	for (const nodeRuntime of [true, false]) {
		const response = await entry.fetch(rawRequest(path, "GET", nodeRuntime));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(
			renderLegalPage(legalDocuments[legal as keyof typeof legalDocuments]),
		);
	}
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	"/",
	"/autoplayer",
	"/share/tz4a98xxat96iws9zmbrgj3a",
	`/_serverFn/${"a1b2c3d4".repeat(8)}`,
	"/assets/x-abc123.js",
	"/autoplayer?u=a%2Fb",
	"/autoplayer?u=%5C%25%2E/../#\\",
])("passes normal app path %s through unchanged", async (path) => {
	const fetch = vi.fn(async () => new Response("app handler"));
	const entry = createServerEntry({ fetch });
	for (const nodeRuntime of [true, false]) {
		const request = rawRequest(path, "GET", nodeRuntime);
		const response = await entry.fetch(request);
		expect(await response.text()).toBe("app handler");
		expect(fetch).toHaveBeenLastCalledWith(request);
	}
	expect(fetch).toHaveBeenCalledTimes(2);
});

// Go net/url's single path-unescape pass for this ASCII corpus. Unlike
// decodeURIComponent it leaves '+' alone and permits non-UTF-8 bytes.
function goPathUnescape(path: string): string {
	if (/%(?![0-9a-f]{2})/i.test(path)) throw new Error("invalid URL escape");
	return path.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);
}

// Exact decodeAndResolvePath algorithm from Pangolin 1.24.0:
// https://github.com/fosrl/pangolin/blob/1.24.0/server/lib/pathMatch.ts
function decodeAndResolvePath(p: string): string[] {
	const rawParts = p.split("/").filter(Boolean);
	const resolved: string[] = [];
	for (const rawPart of rawParts) {
		let part: string;
		try {
			part = decodeURIComponent(rawPart);
		} catch {
			part = rawPart;
		}
		for (const segment of part.split("/").filter(Boolean)) {
			if (segment === ".") {
				// biome-ignore lint/complexity/noUselessContinue: Preserve Pangolin's algorithm verbatim.
				continue;
			} else if (segment === "..") {
				resolved.pop();
			} else {
				resolved.push(segment);
			}
		}
	}
	return resolved;
}

function edgePath(path: string): string {
	return `/${decodeAndResolvePath(goPathUnescape(path)).join("/")}`;
}

it.each(bypasses)("models the confirmed edge bypass %s", (path) => {
	expect(edgePath(path)).toBe("/privacy");
});

it("never dispatches an edge-public generated path to the app", async () => {
	const segments = [
		"a",
		"a\\b",
		"..",
		".",
		"%2F",
		"%252F",
		"%25252F",
		"%5C",
		"%2e%2e",
		"privacy",
		"_serverFn",
		"ID",
		"",
		"privac%79",
	];
	const prefixes = [""];
	let level = [""];
	for (let depth = 0; depth < 3; depth++) {
		level = level.flatMap((prefix) =>
			segments.map((segment) => `${prefix}/${segment}`),
		);
		prefixes.push(...level);
	}
	const fetch = vi.fn(async () => new Response("app handler"));
	const entry = createServerEntry({ fetch });
	const covered = new Set<string>();
	let checked = 0;
	for (const prefix of prefixes) {
		for (const legal of Object.keys(legalDocuments)) {
			for (const path of [
				`${prefix}${legal}`,
				`/_serverFn/ID${prefix}/../../../${legal.slice(1)}`,
			]) {
				const canonical = edgePath(path);
				if (!(canonical in legalDocuments)) continue;
				const response = await entry.fetch(rawRequest(path));
				expect([200, 400], path).toContain(response.status);
				if (response.status === 200) {
					expect(await response.text(), path).toBe(
						renderLegalPage(
							legalDocuments[canonical as keyof typeof legalDocuments],
						),
					);
				}
				covered.add(canonical);
				checked++;
			}
		}
	}
	expect([...covered].sort()).toEqual(Object.keys(legalDocuments).sort());
	expect(checked).toBeGreaterThan(1_000);
	expect(fetch).not.toHaveBeenCalled();
	expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
});

it.each(["/impressum", "/datenschutz", "/legal-notice", "/privacy"])(
	"serves %s before app rendering, loaders and request telemetry",
	async (path) => {
		const fetch = vi.fn(async () => {
			throw new Error("The app renderer is unavailable");
		});
		const response = await createServerEntry({ fetch }).fetch(
			new Request(`http://localhost${path}`),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Tobias Heer");
		expect(fetch).not.toHaveBeenCalled();
		expect(telemetry.render).not.toHaveBeenCalled();
		expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
	},
);

it.each([
	["/health", "browser"],
	["/", "kube-probe/1.35"],
	["/autoplayer", "kube-probe/1.35"],
])("does not trace %s with user agent %s", async (pathname, userAgent) => {
	const fetch = vi.fn(async () => new Response("ok"));
	const entry = createServerEntry({ fetch });
	expect(
		(
			await entry.fetch(
				new Request(`http://localhost${pathname}`, {
					headers: { "user-agent": userAgent },
				}),
			)
		).status,
	).toBe(200);
	expect(fetch).toHaveBeenCalledOnce();
	expect(telemetry.withTelemetrySpan).not.toHaveBeenCalled();
});

it("traces ordinary requests without putting a URL in the transaction name", async () => {
	await createServerEntry({ fetch: async () => new Response("ok") }).fetch(
		new Request("http://localhost/autoplayer/private?token=private"),
	);
	expect(telemetry.withTelemetrySpan).toHaveBeenCalledWith(
		"GET unmatched",
		"http.server",
		expect.any(Function),
	);
});

it("renames the frontend span from Router's matched route pattern", async () => {
	await server.fetch(
		new Request("http://localhost/playlist/private-id?token=private"),
	);
	expect(telemetry.updateTelemetrySpanName).toHaveBeenCalledWith(
		"GET /playlist/$id",
	);
});
