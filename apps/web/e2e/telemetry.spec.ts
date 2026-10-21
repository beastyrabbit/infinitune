import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const script = await readFile(new URL("./fixtures/umami-script.js", import.meta.url), "utf8");

test("production telemetry, SPA pageviews, privacy, and storage", async ({ browser }) => {
	const context = await browser.newContext();
	// Exercise the real-user path. The automation-disabled path has its own test.
	await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
	const page = await context.newPage();
	const sends: Array<Record<string, unknown>> = [];
	const envelopes: string[] = [];
	let scriptRequests = 0;
	await context.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
		if (url.hostname === "umami.heerlab.com") {
			if (url.pathname === "/script.js") { scriptRequests++; return route.fulfill({ contentType: "application/javascript", body: script }); }
			if (url.pathname === "/api/send") { if (request.method() === "POST") sends.push(request.postDataJSON()); return route.fulfill({ headers, json: { cache: "e2e-cache" } }); }
			if (url.pathname.endsWith("/recorder")) return route.fulfill({ headers, json: { enabled: true, replayEnabled: true, heatmapEnabled: true, sampleRate: 1, heatmapSampleRate: 1, maskLevel: "strict", blockSelector: "input,textarea,select,[data-telemetry-private]" } });
			if (url.pathname === "/recorder.js") return route.fulfill({ contentType: "application/javascript", body: "/* Replay transport tested separately with synthetic rrweb payloads. */" });
			return route.fulfill({ headers, json: {} });
		}
		if (url.hostname === "glitchtip.heerlab.com") {
			if (request.method() === "POST") envelopes.push(request.postData() || "");
			return route.fulfill({ headers, json: { id: "e2e" } });
		}
		if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
		if (url.pathname === "/api/radio/state") return route.fulfill({ json: { station: { id: "radio", isPlaying: false, activeListenerCount: 0 }, currentSong: null, schedule: [] } });
		if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
		return route.continue();
	});
	await page.routeWebSocket("**/ws*", (ws) => ws.close());
	await page.goto("http://127.0.0.1:4471/telemetry-check");
	await expect.poll(() => sends.length).toBeGreaterThan(0);
	expect(scriptRequests).toBe(1);
	expect(sends[0]).toMatchObject({ type: "event", payload: { website: "16206c2c-c965-46db-8f19-4b60bd97adb6", hostname: "127.0.0.1", url: "/telemetry-check", title: "INFINITUNE" } });
	expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
	// Test the script's History API patch and actual TanStack Link navigation.
	await page.goto("http://127.0.0.1:4471/autoplayer");
	await page.getByRole("link", { name: "Settings", exact: true }).first().click();
	await expect.poll(() => sends.some((event) => (event.payload as { url?: string }).url === "/autoplayer/settings")).toBe(true);
	const documents = scriptRequests;
	await page.evaluate(() => {
		const anchor = document.createElement("a"); anchor.href = "/telemetry-next?token=private-route#private-hash"; anchor.textContent = "Next";
		anchor.onclick = (event) => { event.preventDefault(); history.pushState({}, "", anchor.href); };
		document.body.append(anchor); anchor.click();
	});
	await expect.poll(() => sends.some((event) => (event.payload as { url?: string }).url === "/telemetry-next")).toBe(true);
	expect(scriptRequests).toBe(documents);
	const beforeBack = sends.length;
	await page.goBack();
	await expect.poll(() => sends.slice(beforeBack).some((event) => (event.payload as { url?: string }).url === "/autoplayer/settings")).toBe(true);
	await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll("script[src]")].some((script) => (script as HTMLScriptElement).src.includes("recorder.js")))).toBe(true);
	// Wait for the lazily imported SDK before throwing an unhandled error.
	await page.waitForTimeout(1000);
	await page.evaluate(() => { setTimeout(() => { throw new Error("Telemetry e2e private@example.com token=private-token https://example.com/?code=private-code"); }, 0); });
	await expect.poll(() => envelopes.some((envelope) => envelope.includes("Telemetry e2e")), { timeout: 10000 }).toBe(true);
	const envelope = envelopes.find((item) => item.includes("Telemetry e2e")) || "";
	expect(envelope).toContain('"release":"e2e-1.3.0"');
	expect(envelope).toContain('"environment":"e2e"');
	expect(envelope).not.toMatch(/private@example|private-token|private-code|private-route|private-hash/);
	expect(envelopes.join("\n")).not.toContain('"type":"session"');
	expect(await context.cookies()).toEqual([]);
	const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
	// This exact Umami script reads umami.disabled but writes no storage. The
	// enabled Sentry integrations keep their state in memory. No identity/replay
	// Sentry integration or Umami distinct ID is enabled.
	expect(storage.local).toEqual([]);
	expect(storage.session.sort()).toEqual(["infinitune-radio-listener-id", "tsr-scroll-restoration-v1_3"]);
	await context.close();
});

for (const [name, port, realUser] of [["missing config", 4472, true], ["domain excluded", 4473, true], ["automation", 4471, false]] as const) {
	test(`Umami stays off for ${name}`, async ({ browser }) => {
		const context = await browser.newContext();
		if (realUser) await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
		const telemetryRequests: string[] = [];
		await context.route("**/*", (route) => {
			const url = new URL(route.request().url());
			if (url.hostname === "umami.heerlab.com") telemetryRequests.push(url.href);
			if (url.hostname !== "127.0.0.1") return route.fulfill({ json: {} });
			if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
			return route.continue();
		});
		const page = await context.newPage();
		await page.routeWebSocket("**/ws*", (ws) => ws.close());
		await page.goto(`http://127.0.0.1:${port}/telemetry-check`);
		await page.waitForTimeout(1000);
		expect(telemetryRequests).toEqual([]);
		await context.close();
	});
}
