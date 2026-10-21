// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
	getLegalResponse,
	legalDocuments,
	renderLegalPage,
} from "./pages.server";

describe("standalone legal pages", () => {
	it.each(Object.entries(legalDocuments))(
		"serves %s with the verified operator and no external resources",
		async (path, document) => {
			const response = getLegalResponse(
				new Request(`https://infinitune.heerlab.com${path}`),
			);
			expect(response?.status).toBe(200);
			expect(response?.headers.get("X-Robots-Tag")).toBe("noindex");
			expect(response?.headers.get("Content-Type")).toContain("text/html");
			const html = await response?.text();
			expect(html).toBe(renderLegalPage(document));
			const page = new DOMParser().parseFromString(html ?? "", "text/html");
			for (const value of [
				"Tobias Heer",
				"c/o Impressumservice Dein-Impressum",
				"Stettiner Str. 41",
				"35410 Hungen",
			]) {
				expect(page.body.textContent).toContain(value);
			}
			for (const href of [
				"mailto:impressum-infinitune@heerlab.com",
				"mailto:datenschutz-infinitune@heerlab.com",
				"https://beastyrabbit.com/kontakt?from=infinitune",
			]) {
				expect(page.querySelector(`a[href="${href}"]`)).not.toBeNull();
			}
			expect(page.documentElement.lang).toBe(document.lang);
			expect(
				page.querySelector('meta[name="robots"]')?.getAttribute("content"),
			).toBe("noindex");
			expect(
				page.querySelectorAll("script, iframe, img, link[rel=stylesheet]"),
			).toHaveLength(0);
			expect(page.querySelectorAll("style")).toHaveLength(1);
			expect(html).not.toMatch(/TODO\(user\)|\[\[|Hetzner|<!--|@import|url\(/);
			for (const target of Object.keys(legalDocuments).filter(
				(target) => target !== path,
			)) {
				// The other language's other document is two links away.
				if (
					legalDocuments[target as keyof typeof legalDocuments].kind ===
						document.kind ||
					legalDocuments[target as keyof typeof legalDocuments].lang ===
						document.lang
				) {
					expect(page.querySelector(`a[href="${target}"]`)).not.toBeNull();
				}
			}
		},
	);

	it("keeps both languages aligned section by section", () => {
		for (const [german, english] of [
			["/impressum", "/legal-notice"],
			["/datenschutz", "/privacy"],
		] as const) {
			expect(
				legalDocuments[german].sections.map((section) => section.id),
			).toEqual(legalDocuments[english].sections.map((section) => section.id));
		}
	});
	it.each(["/datenschutz", "/privacy"] as const)(
		"keeps %s limited to the verified production integrations",
		(path) => {
			const html = renderLegalPage(legalDocuments[path]);
			for (const expected of [
				"OpenAI Ireland Limited",
				"D01 YC43",
				"p_session_token_s.",
				"HttpOnly, Secure, SameSite=Lax",
				"umami.disabled",
			])
				expect(html).toContain(expected);
			for (const unused of [
				"YouTube",
				"SoundCloud",
				"Bandcamp",
				"LRCLIB",
				"DuckDuckGo",
				"Wikipedia",
				"OpenRouter",
				"Inference.sh",
				"Shoo",
				"Resend",
				"infinitune-shoo-id-token",
			])
				expect(html).not.toContain(unused);
		},
	);

	it.each([
		["/privacy/", "/privacy"],
		["//privacy", "/privacy"],
		["/privac%79", "/privacy"],
		["//impressum//", "/impressum"],
	])("serves only static legal HTML for alias %s", async (alias, canonical) => {
		for (const method of ["GET", "HEAD", "POST"]) {
			const request = new Request(`https://infinitune.heerlab.com${alias}`, {
				method,
			});
			Object.assign(request, {
				runtime: { node: { req: { url: `${alias}?ignored=1` } } },
			});
			const response = getLegalResponse(request);
			const expected = getLegalResponse(
				new Request(`https://infinitune.heerlab.com${canonical}`, { method }),
			);
			expect(response).toBeDefined();
			if (!response || !expected) throw new Error("Missing legal response");
			expect(response.status).toBe(expected.status);
			expect([...response.headers]).toEqual([...expected.headers]);
			expect(await response.text()).toBe(await expected.text());
		}
	});

	it("handles HEAD and rejects mutations without expanding the public paths", async () => {
		const head = getLegalResponse(
			new Request("https://infinitune.heerlab.com/privacy", { method: "HEAD" }),
		);
		expect(head?.status).toBe(200);
		expect(await head?.text()).toBe("");
		const post = getLegalResponse(
			new Request("https://infinitune.heerlab.com/privacy", { method: "POST" }),
		);
		expect(post?.status).toBe(405);
		expect(post?.headers.get("Allow")).toBe("GET, HEAD");
		for (const path of [
			"/privacy/child",
			"/privacy-extra",
			"/privacy/settings",
			"/Privacy",
			"/privacy%",
			"/api/privacy",
			"/constructor",
		]) {
			expect(
				getLegalResponse(new Request(`https://infinitune.heerlab.com${path}`)),
			).toBeUndefined();
		}
	});
});
