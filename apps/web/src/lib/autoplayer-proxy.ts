import { API_URL } from "./endpoints";

const PANGOLIN_IDENTITY_HEADERS = [
	"Remote-User-Id",
	"Remote-Email",
	"Remote-Name",
] as const;

export async function proxyAutoplayerRequest(
	request: Request,
	path: string,
): Promise<Response> {
	const sourceUrl = new URL(request.url);
	const targetUrl = new URL(`${API_URL}/api/autoplayer${path}`);
	targetUrl.search = sourceUrl.search;

	const method = request.method.toUpperCase();
	const headers = new Headers();
	const contentType = request.headers.get("content-type");
	if (contentType) headers.set("content-type", contentType);
	const authorization = request.headers.get("authorization");
	if (authorization) headers.set("authorization", authorization);
	if (
		typeof process !== "undefined" &&
		process.env.INFINITUNE_TRUST_PANGOLIN_HEADERS === "true"
	) {
		for (const headerName of PANGOLIN_IDENTITY_HEADERS) {
			const value = request.headers.get(headerName);
			if (value !== null) headers.set(headerName, value);
		}
	}

	const init: RequestInit = {
		method,
		headers,
		signal: request.signal,
	};
	if (method !== "GET" && method !== "HEAD") {
		init.body = await request.text();
	}

	const upstream = await fetch(targetUrl, init);
	const body = await upstream.arrayBuffer();
	const responseHeaders = new Headers();
	const upstreamType = upstream.headers.get("content-type");
	if (upstreamType) responseHeaders.set("content-type", upstreamType);
	return new Response(body, {
		status: upstream.status,
		headers: responseHeaders,
	});
}
