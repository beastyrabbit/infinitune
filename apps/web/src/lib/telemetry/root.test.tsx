// @vitest-environment jsdom
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	type RootRouteOptions,
	RouterProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ getTelemetryConfig: vi.fn() }));
vi.mock("./Telemetry", () => ({ Telemetry: () => null }));
vi.mock("./sentry", () => ({ captureBrowserError: vi.fn() }));
vi.mock("../../styles.css?url", () => ({ default: "/assets/styles.css" }));
vi.mock("../../integrations/api/provider", () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}));

import { Route } from "../../routes/__root";
import { getTelemetryConfig } from "./config";

beforeEach(() => vi.clearAllMocks());

it("keeps the app usable when configuration fails and reuses the root loader on navigation", async () => {
	vi.mocked(getTelemetryConfig).mockRejectedValue(new Error("Network error"));
	const routeTree = Route.addChildren([
		createRoute({
			getParentRoute: () => Route,
			path: "/",
			component: () => "Player",
		}),
		createRoute({
			getParentRoute: () => Route,
			path: "/autoplayer/settings",
			component: () => "Settings",
		}),
	]);
	const router = createRouter({
		routeTree,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	expect(router.state.matches[0]).toMatchObject({
		status: "success",
		loaderData: null,
	});
	await router.navigate({ to: "/autoplayer/settings" });
	await router.navigate({ to: "/" });
	expect(getTelemetryConfig).toHaveBeenCalledOnce();
});

it("renders root errors inside the styled document shell", async () => {
	vi.mocked(getTelemetryConfig).mockRejectedValue(new Error("Network error"));
	const router = createRouter({
		isServer: true,
		routeTree: createRootRoute({
			shellComponent: (Route.options as RootRouteOptions).shellComponent,
			errorComponent: Route.options.errorComponent,
			loader: () => {
				throw new Error("Route failed");
			},
		}),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	const html = renderToString(<RouterProvider router={router} />);
	expect(html).toContain('<html lang="en" class="dark">');
	expect(html).toContain("<head>");
	expect(html).toContain('<body class="rr-mask bg-gray-950');
	expect(html).toContain(
		'role="alert" class="font-mono min-h-screen bg-gray-950',
	);
	expect(html).toContain("Try again");
});
