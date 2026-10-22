import { afterEach, expect, it, vi } from "vitest";
import versionRoutes from "../routes/version";

afterEach(() => vi.unstubAllEnvs());

it("reports only the release and forbids caching", async () => {
	vi.stubEnv("INFINITUNE_RELEASE", "1.5.0");
	const response = await versionRoutes.request("/");
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.json()).toEqual({ release: "1.5.0" });
});

it("falls back to dev when no release is baked in", async () => {
	vi.stubEnv("INFINITUNE_RELEASE", "");
	const response = await versionRoutes.request("/");
	expect(await response.json()).toEqual({ release: "dev" });
});
