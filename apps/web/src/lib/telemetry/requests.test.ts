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
	"/playlist/summer%2F2026",
	"/playlist/100%25%20chill",
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
