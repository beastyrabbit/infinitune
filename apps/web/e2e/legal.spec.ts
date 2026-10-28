import { expect, test } from "@playwright/test";

const origin = "http://127.0.0.1:4471";

test("legal path aliases stop before the SSR app and server functions", async ({ request }) => {
	for (const path of [
		"/privacy/",
		"//privacy",
		"/privac%79",
	]) {
		const url = `${origin}${path}`;
		const response = await request.get(url);
		expect(response.status()).toBe(200);
		expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
		expect(await response.text()).toContain("<h1>Privacy Policy</h1>");
		expect(await response.text()).not.toContain("<script");
		const head = await request.head(url);
		expect(head.status()).toBe(200);
		expect(await head.body()).toHaveLength(0);
		const post = await request.post(url);
		expect(post.status()).toBe(405);
		expect(post.headers().allow).toBe("GET, HEAD");
	}
});

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
		await page.goto(`${origin}/autoplayer/settings`);
		await expect(page.getByRole("button", { name: "Save radio settings", exact: true })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Radio Settings", exact: true })).toBeVisible();
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const privacy = page.getByRole("navigation", { name: "Legal information", exact: true }).getByRole("link", { name: "Privacy", exact: true });
		await expect(privacy).toBeVisible();
		expect(await privacy.evaluate((link) => {
			const rect = link.getBoundingClientRect();
			return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === link;
		})).toBe(true);
		await privacy.click();
		await expect(page).toHaveURL(`${origin}/privacy`);
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

		// Legal pages need no application JavaScript, API access or external assets.
		// Production access is protected by Pangolin SSO.
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
			await expect(legal.locator('a[href="mailto:impressum-infinitune@heerlab.com"]').first()).toBeVisible();
			await expect(legal.locator('a[href="mailto:datenschutz-infinitune@heerlab.com"]').first()).toBeVisible();
			await expect(legal.locator('a[href="https://beastyrabbit.com/kontakt?from=infinitune"]').first()).toBeVisible();
			await expect(legal.locator("body")).not.toContainText("[[");
			await expect(legal.locator("body")).not.toContainText("TODO(user)");
			await expect(legal.locator("body")).not.toContainText("Hetzner");
			expect(await legal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		}
		expect(requests).toEqual(["/impressum", "/datenschutz", "/legal-notice", "/privacy"].map((path) => `${origin}${path}`));
		expect(await standalone.cookies()).toEqual([]);
		await standalone.close();
	});
}
