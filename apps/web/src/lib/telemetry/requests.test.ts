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

beforeEach(() => vi.clearAllMocks());

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
