import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4471";

for (const viewport of [
	{ width: 1280, height: 900 },
	{ width: 390, height: 844 },
]) {
	test(`legal links and standalone pages at ${viewport.width}px`, async ({ browser }) => {
		const context = await browser.newContext({ viewport });
		await context.route("**/*", (route) => {
			const url = new URL(route.request().url());
			if (url.hostname === "umami.heerlab.com" || url.hostname === "glitchtip.heerlab.com") {
				return route.fulfill({ json: {} });
			}
			if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
			if (url.pathname === "/api/radio/state") {
				return route.fulfill({ json: { station: { id: "radio", isPlaying: false, activeListenerCount: 0 }, currentSong: null, schedule: [] } });
			}
			if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
			return route.continue();
		});
		const page = await context.newPage();
		await page.routeWebSocket("**/ws*", (socket) => socket.close());
		for (const [label, path, heading] of [
			["Legal notice", "/legal-notice", "Legal Notice (Impressum)"],
			["Privacy", "/privacy", "Privacy Policy"],
		]) {
			await page.goto(origin);
			await page.getByRole("navigation", { name: "Legal information", exact: true }).getByRole("link", { name: label, exact: true }).click();
			await expect(page).toHaveURL(`${origin}${path}`);
			await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
			await expect(page.locator("main")).toContainText("Tobias Heer");
			await expect(page.locator("main")).toContainText("35410 Hungen");
			await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
			await expect(page.locator("script")).toHaveCount(0);
			await page.getByRole("link", { name: "Deutsch", exact: true }).first().click();
			await expect(page.locator("html")).toHaveAttribute("lang", "de");
			await expect(page.getByRole("heading", { name: path === "/privacy" ? "Datenschutzerklärung" : "Impressum", exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		}
		await context.close();

		// Public pages must work without application JavaScript, API access, an
		// authenticated session or any external/static dependency.
		const standalone = await browser.newContext({ viewport, javaScriptEnabled: false });
		const requests: string[] = [];
		await standalone.route("**/*", (route) => {
			const request = route.request();
			requests.push(request.url());
			return request.isNavigationRequest() && new URL(request.url()).origin === origin
				? route.continue()
				: route.abort("blockedbyclient");
		});
		const legal = await standalone.newPage();
		for (const path of ["/impressum", "/datenschutz", "/legal-notice", "/privacy"]) {
			const response = await legal.goto(`${origin}${path}`);
			expect(response?.status()).toBe(200);
			expect(response?.headers()["x-robots-tag"]).toBe("noindex");
			await expect(legal.locator("main")).toContainText("c/o Impressumservice Dein-Impressum");
			await expect(legal.locator('a[href="mailto:impressum@heerlab.com"]').first()).toBeVisible();
			await expect(legal.locator('a[href="mailto:datenschutz@heerlab.com"]').first()).toBeVisible();
			await expect(legal.locator('a[href="https://beastyrabbit.com/kontakt"]').first()).toBeVisible();
			await expect(legal.locator("body")).not.toContainText("[[");
			expect(await legal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		}
		expect(requests).toEqual(["/impressum", "/datenschutz", "/legal-notice", "/privacy"].map((path) => `${origin}${path}`));
		expect(await standalone.cookies()).toEqual([]);
		await standalone.close();
	});
}
