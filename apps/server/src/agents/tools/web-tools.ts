import { Type } from "@mariozechner/pi-ai";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { isPrivateIp, publicHttpRequestBuffer } from "../../utils/public-http";
import {
	type AgentId,
	assertAgentToolAllowed,
	isAgentToolAllowed,
} from "../agent-registry";

export interface MusicWebResult {
	title: string;
	url: string;
	snippet: string;
}

const BLOCKED_LYRICS_RE =
	/\b(lyrics?|azlyrics|genius|musixmatch|lyricfind|metrolyrics)\b/i;
const BLOCKED_HOST_RE =
	/(^|\.)((localhost)|(localdomain)|(internal)|(home\.arpa))$/i;
const PRIVATE_IPV4_RE =
	/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/;
const MAX_FETCH_BYTES = 128 * 1024;

function jsonResult(details: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(details) }],
		details,
	};
}

function stripHtml(value: string): string {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function clampLimit(value: unknown, fallback: number, max: number): number {
	const parsed = typeof value === "number" ? Math.floor(value) : fallback;
	return Math.max(1, Math.min(parsed, max));
}

function assertNoLyricLookup(query: string): void {
	if (BLOCKED_LYRICS_RE.test(query)) {
		throw new Error(
			"Full copyrighted lyric lookup is disabled. Search public song facts, chart/list context, release details, themes, and broad song meaning instead.",
		);
	}
}

function decodeHtml(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#039;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, " ");
}

function publicHttpUrl(rawUrl: string): URL {
	const url = new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only public http/https URLs are allowed.");
	}
	const hostname = url.hostname.toLowerCase();
	const isIpv6Literal = hostname.includes(":");
	if (
		hostname === "localhost" ||
		BLOCKED_HOST_RE.test(hostname) ||
		PRIVATE_IPV4_RE.test(hostname) ||
		hostname === "0.0.0.0" ||
		hostname === "::1" ||
		hostname.startsWith("[") ||
		(isIpv6Literal && isPrivateIp(hostname))
	) {
		throw new Error("Local, private, and internal network URLs are blocked.");
	}
	assertNoLyricLookup(url.toString());
	return url;
}

async function fetchTextWithTimeout(url: string, timeoutMs = 8000) {
	const publicUrl = publicHttpUrl(url);
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("Web fetch timed out")),
		timeoutMs,
	);
	try {
		const { response, buffer } = await publicHttpRequestBuffer(publicUrl, {
			signal: controller.signal,
			maxBytes: MAX_FETCH_BYTES,
			blockedAddressMessage:
				"Local, private, and internal network URLs are blocked.",
			sizeErrorMessage: "Web fetch response is too large.",
			abortMessage: "Web fetch aborted",
			headers: {
				"user-agent":
					"Infinitune/1.0 music planning research (local development)",
			},
		});
		if (response.status >= 300 && response.status < 400) {
			throw new Error("Redirects are blocked for agent web fetches.");
		}
		return {
			response,
			text: buffer.toString("utf8"),
		};
	} finally {
		clearTimeout(timeout);
	}
}

function parseDuckDuckGoResults(html: string, limit: number): MusicWebResult[] {
	const results: MusicWebResult[] = [];
	const seen = new Set<string>();
	const resultRe =
		/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
	for (const match of html.matchAll(resultRe)) {
		const rawHref = decodeHtml(match[1] ?? "");
		const title = stripHtml(decodeHtml(match[2] ?? ""));
		const snippet = stripHtml(decodeHtml(match[3] ?? ""));
		if (!rawHref || !title) continue;
		let href = rawHref;
		try {
			const parsed = new URL(rawHref, "https://duckduckgo.com");
			const redirected = parsed.searchParams.get("uddg");
			href = redirected ? decodeURIComponent(redirected) : parsed.toString();
			publicHttpUrl(href);
		} catch {
			continue;
		}
		const key = href.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({ title: title.slice(0, 140), url: href, snippet });
		if (results.length >= limit) break;
	}
	return results;
}

export async function webSearch(
	query: string,
	limit = 5,
): Promise<MusicWebResult[]> {
	const safeQuery = query.trim().slice(0, 240);
	if (!safeQuery) return [];
	assertNoLyricLookup(safeQuery);

	const url = new URL("https://html.duckduckgo.com/html/");
	url.searchParams.set("q", safeQuery);
	const { response, text: html } = await fetchTextWithTimeout(url.toString());
	if (!response.ok) throw new Error(`Web search failed: ${response.status}`);
	const results = parseDuckDuckGoResults(
		html,
		Math.max(1, Math.min(limit, 10)),
	);
	if (results.length > 0) return results;

	return await webSearchMusicFacts(safeQuery, limit);
}

export async function webFetchUrl(rawUrl: string): Promise<{
	url: string;
	title: string;
	text: string;
	truncated: boolean;
}> {
	const url = publicHttpUrl(rawUrl);
	const { response, text: body } = await fetchTextWithTimeout(url.toString());
	if (!response.ok) throw new Error(`Web fetch failed: ${response.status}`);
	const contentType = response.headers.get("content-type") ?? "";
	if (
		!contentType.includes("text/html") &&
		!contentType.includes("text/plain") &&
		!contentType.includes("application/json")
	) {
		throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
	}
	const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch
		? stripHtml(decodeHtml(titleMatch[1]))
		: url.hostname;
	const text = stripHtml(decodeHtml(body));
	const maxChars = 5000;
	return {
		url: url.toString(),
		title: title.slice(0, 180),
		text: text.slice(0, maxChars),
		truncated: text.length > maxChars,
	};
}

export async function webSearchMusicFacts(
	query: string,
	limit = 5,
): Promise<MusicWebResult[]> {
	const safeQuery = query.trim().slice(0, 200);
	if (!safeQuery) return [];
	assertNoLyricLookup(safeQuery);

	const url = new URL("https://en.wikipedia.org/w/api.php");
	url.searchParams.set("action", "query");
	url.searchParams.set("list", "search");
	url.searchParams.set("format", "json");
	url.searchParams.set("utf8", "1");
	url.searchParams.set("srlimit", String(Math.max(1, Math.min(limit, 10))));
	url.searchParams.set("srsearch", safeQuery);

	const { response, text } = await fetchTextWithTimeout(url.toString());
	if (!response.ok) {
		throw new Error(`Music web search failed: ${response.status}`);
	}
	const data = JSON.parse(text) as {
		query?: {
			search?: Array<{
				pageid?: number;
				title?: string;
				snippet?: string;
			}>;
		};
	};

	return (data.query?.search ?? [])
		.flatMap((result) => {
			if (!result.pageid || !result.title) return [];
			return [
				{
					title: stripHtml(result.title).slice(0, 140),
					url: `https://en.wikipedia.org/?curid=${result.pageid}`,
					snippet: stripHtml(result.snippet ?? "").slice(0, 260),
				},
			];
		})
		.slice(0, limit);
}

function sourceCandidateQueries(input: {
	playlistPrompt?: string;
	query?: string;
	era?: string;
}): string[] {
	const prompt = `${input.playlistPrompt ?? ""} ${input.query ?? ""}`.trim();
	const queries = new Set<string>();
	if (input.query?.trim()) queries.add(input.query.trim());
	queries.add("greatest songs of all time popular music list");
	queries.add("best selling singles popular songs all time");
	if (/\b(90s|90's|90is|1990s|nineties)\b/i.test(prompt)) {
		queries.add("1990s Billboard Hot 100 number-one singles");
		queries.add("Billboard Year-End Hot 100 singles 1990s");
	}
	if (input.era?.trim()) {
		queries.add(`${input.era.trim()} popular songs Billboard Hot 100`);
	}
	return [...queries].slice(0, 4);
}

export async function getSourceSongCandidateFacts(input: {
	playlistPrompt?: string;
	query?: string;
	era?: string;
	limit?: number;
}): Promise<{ queries: string[]; results: MusicWebResult[] }> {
	const prompt = `${input.playlistPrompt ?? ""} ${input.query ?? ""}`;
	const shouldResearch =
		/\b(popular|famous|greatest|top songs?|all time|hits?|chart|billboard|90s|90is|1990s)\b/i.test(
			prompt,
		) || !!input.query?.trim();
	if (!shouldResearch) return { queries: [], results: [] };

	const limit = clampLimit(input.limit, 8, 20);
	const queries = sourceCandidateQueries(input);
	const seen = new Set<string>();
	const results: MusicWebResult[] = [];
	for (const query of queries) {
		const found = await webSearch(query, 5).catch(() => []);
		for (const result of found) {
			const key = `${result.title.toLowerCase()}|${result.url}`;
			if (seen.has(key)) continue;
			seen.add(key);
			results.push(result);
			if (results.length >= limit) {
				return { queries, results };
			}
		}
	}
	return { queries, results };
}

export function createWebResearchTools(agentId: AgentId): ToolDefinition[] {
	const tools: ToolDefinition[] = [
		{
			name: "web_search",
			label: "Search Web",
			description:
				"Search the public web for current facts and sources. Does not allow full copyrighted lyric lookup.",
			promptSnippet:
				"Use web_search for current public facts. Do not search for full copyrighted lyrics.",
			parameters: Type.Object({
				query: Type.String(),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "web_search");
				const p = params as { query: string; limit?: number };
				return jsonResult({
					results: await webSearch(p.query, clampLimit(p.limit, 5, 10)),
					lyricsPolicy:
						"Full copyrighted lyric lookup is disabled; use public facts and broad song meaning.",
				});
			},
		},
		{
			name: "web_fetch_url",
			label: "Fetch Web URL",
			description:
				"Fetch a public http/https web page and return a compact text excerpt. Local/private URLs and full copyrighted lyric lookup are blocked.",
			promptSnippet:
				"Use web_fetch_url to inspect public sources found through web_search.",
			parameters: Type.Object({
				url: Type.String(),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "web_fetch_url");
				const p = params as { url: string };
				return jsonResult({
					...(await webFetchUrl(p.url)),
					lyricsPolicy:
						"Do not reproduce protected lyrics. Summarize public facts only.",
				});
			},
		},
		{
			name: "web_search_music_facts",
			label: "Search Music Facts",
			description:
				"Search the public web for music facts, chart/list context, release details, themes, and broad song meaning. This tool never returns full copyrighted lyrics.",
			promptSnippet:
				"Use web research for source-song facts and popularity context. Do not search for or quote full lyrics.",
			parameters: Type.Object({
				query: Type.String(),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "web_search_music_facts");
				const p = params as { query: string; limit?: number };
				return jsonResult({
					results: await webSearchMusicFacts(
						p.query,
						clampLimit(p.limit, 5, 10),
					),
					lyricsPolicy:
						"Full copyrighted lyric lookup is disabled; preserve broad premise/tone only unless lyrics are public domain or rights-approved.",
				});
			},
		},
		{
			name: "source_song_candidates",
			label: "Find Source Song Candidates",
			description:
				"Find public chart/list context to help select globally recognizable source songs. Does not return or fetch full lyrics.",
			promptSnippet:
				"Use for popular/famous source-song selection, then choose distinct sources per slot.",
			parameters: Type.Object({
				playlistPrompt: Type.Optional(Type.String()),
				query: Type.Optional(Type.String()),
				era: Type.Optional(Type.String()),
				limit: Type.Optional(Type.Number()),
			}),
			execute: async (_id, params) => {
				assertAgentToolAllowed(agentId, "source_song_candidates");
				const p = params as {
					playlistPrompt?: string;
					query?: string;
					era?: string;
					limit?: number;
				};
				return jsonResult({
					...(await getSourceSongCandidateFacts({
						playlistPrompt: p.playlistPrompt,
						query: p.query,
						era: p.era,
						limit: clampLimit(p.limit, 8, 20),
					})),
					lyricsPolicy:
						"Do not copy protected lyrics. Use source facts to preserve identity, mood, and broad story beats.",
				});
			},
		},
	];
	return tools.filter((tool) => isAgentToolAllowed(agentId, tool.name));
}
