import { notice as noticeDe, privacy as privacyDe } from "./de";
import { notice as noticeEn, privacy as privacyEn } from "./en";
import type { LegalDocument } from "./types";

export const legalDocuments = {
	"/impressum": noticeDe,
	"/datenschutz": privacyDe,
	"/legal-notice": noticeEn,
	"/privacy": privacyEn,
} satisfies Record<string, LegalDocument>;

const style = `
:root{color-scheme:dark;--background:oklch(0.141 0.005 285.823);--foreground:oklch(0.985 0 0);--border:oklch(0.274 0.006 286.033);--muted:oklch(0.705 0.015 286.067)}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:1rem/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Fira Sans","Droid Sans","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
header,main,footer{width:min(100% - 2.5rem,54rem);margin-inline:auto}header{padding-block:2rem;border-bottom:1px solid var(--border)}nav{display:flex;flex-wrap:wrap;gap:.6rem 1.5rem}a{color:inherit;text-underline-offset:.25em;overflow-wrap:anywhere}a:hover{color:#eab308}a:focus-visible{outline:2px solid #eab308;outline-offset:5px}
.brand{display:block;margin-bottom:1.25rem;font:900 1rem/1.5 ui-monospace,Menlo,Monaco,Consolas,"Courier New",monospace;letter-spacing:.2em;text-decoration:none}main{padding-block:2rem 4rem}h1,h2{line-height:1.3;overflow-wrap:anywhere}h1{font-size:clamp(1.85rem,6vw,2.75rem);margin:0 0 1rem}h2{font-size:1.25rem;margin:0 0 1.25rem}section{padding-top:2rem;margin-top:2rem;border-top:1px solid var(--border)}p,li,td{overflow-wrap:anywhere}p{margin:0 0 1rem}ul{padding-left:1.5rem}.updated,footer{color:var(--muted);font-size:.875rem}footer{padding-block:1.5rem 3rem;border-top:1px solid var(--border)}footer p{margin-top:1rem}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:.875rem}th,td{text-align:left;vertical-align:top;padding:.75rem;border:1px solid var(--border)}th{font-weight:700}::selection{background:rgba(234,179,8,.4);color:white}
@media(max-width:40rem){th,td{padding:.4rem;font-size:.75rem}header,main,footer{width:calc(100% - 2rem)}}
`;

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character];
	});
}

export function renderLegalPage(document: LegalDocument): string {
	const german = document.lang === "de";
	const noticePath = german ? "/impressum" : "/legal-notice";
	const privacyPath = german ? "/datenschutz" : "/privacy";
	const languagePath =
		document.kind === "notice"
			? german
				? "/legal-notice"
				: "/impressum"
			: german
				? "/privacy"
				: "/datenschutz";
	const nav = `<a href="${noticePath}">${german ? "Impressum" : "Legal notice"}</a><a href="${privacyPath}">${german ? "Datenschutz" : "Privacy"}</a><a href="${languagePath}" lang="${german ? "en" : "de"}" hreflang="${german ? "en" : "de"}">${german ? "English" : "Deutsch"}</a>`;
	const sections = document.sections
		.map(
			(section, index) =>
				`<section aria-labelledby="${escapeHtml(section.id)}"><h2 id="${escapeHtml(section.id)}">${document.kind === "privacy" ? `${index + 1}. ` : ""}${escapeHtml(section.title)}</h2>${section.html}</section>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="${document.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(document.title)} · Infinitune</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><style>${style}</style></head>
<body><header><a class="brand" href="/">INFINITUNE</a><nav aria-label="${german ? "Rechtliche Informationen und Sprache" : "Legal information and language"}">${nav}</nav></header><main><h1>${escapeHtml(document.title)}</h1><p class="updated">${german ? "Stand" : "Last updated"}: ${escapeHtml(document.updated)}</p>${sections}</main><footer><nav aria-label="${german ? "Rechtliche Informationen" : "Legal information"}">${nav}</nav><p><a href="mailto:impressum-infinitune@heerlab.com">impressum-infinitune@heerlab.com</a> · <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a><br><a href="https://beastyrabbit.com/kontakt?from=infinitune">${german ? "Kontaktformular" : "Contact form"}</a></p></footer></body></html>`;
}

// Render once from authored sections. Serving never calls the API, router loader,
// React renderer or telemetry client, and needs no browser JavaScript or assets.
const pages = new Map(
	Object.entries(legalDocuments).map(([path, document]) => [
		path,
		renderLegalPage(document),
	]),
);

function normalizeLegalPath(pathname: string): string {
	// The server entry rejects escapes that could create path structure.
	const decoded = pathname.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);
	return `/${decoded.split("/").filter(Boolean).join("/")}`;
}

export function getRawRequestPath(request: Request): string {
	// srvx preserves the original Node URI here even when Request.url has already
	// resolved literal dot segments. Inspect it before any URL parsing/decoding.
	const nodeRequest = request as Request & {
		runtime?: { node?: { req?: { url?: string } } };
	};
	const rawUrl = nodeRequest.runtime?.node?.req?.url ?? request.url;
	return rawUrl.replace(/^https?:\/\/[^/?#]*/i, "").split(/[?#]/, 1)[0];
}

export function getLegalResponse(request: Request): Response | undefined {
	// Serve benign aliases directly before any Start loader or server function.
	const rawPath = getRawRequestPath(request);
	const html = pages.get(normalizeLegalPath(rawPath));
	if (html === undefined) return undefined;
	const allowed = request.method === "GET" || request.method === "HEAD";
	return new Response(
		allowed ? (request.method === "HEAD" ? null : html) : "Method not allowed",
		{
			status: allowed ? 200 : 405,
			headers: {
				"Content-Type": allowed
					? "text/html; charset=utf-8"
					: "text/plain; charset=utf-8",
				"X-Robots-Tag": "noindex",
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
				"Referrer-Policy": "no-referrer",
				"X-Content-Type-Options": "nosniff",
				...(!allowed ? { Allow: "GET, HEAD" } : {}),
			},
		},
	);
}
