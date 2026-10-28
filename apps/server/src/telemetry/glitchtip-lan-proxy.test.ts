import { once } from "node:events";
import http, { type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it } from "vitest";

const { createGlitchtipLanProxy } = await import(
	new URL("../../../../scripts/glitchtip-lan-proxy.mjs", import.meta.url).href
);
const chunkPath = "/glitchtip/api/0/organizations/test/chunk-upload/";
const advertisedUrl = `https://glitchtip.example${chunkPath}`;
let upstream: Server;
let proxy: Server;
let respond: RequestListener;
let origin: string;

beforeEach(async () => {
	respond = (_req, res) => {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ url: advertisedUrl, maxFileSize: 1024 }));
	};
	upstream = http.createServer((req, res) => respond(req, res));
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const port = (upstream.address() as AddressInfo).port;
	proxy = createGlitchtipLanProxy(new URL(`http://127.0.0.1:${port}`), 0);
	await once(proxy, "listening");
	origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

afterEach(async () => {
	await Promise.all(
		[proxy, upstream].map(
			(server) =>
				new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				),
		),
	);
});

it.each([chunkPath, chunkPath.slice(0, -1), `${chunkPath}?version=1`])(
	"rewrites the chunk-upload GET URL and preserves its path for %s",
	async (path) => {
		expect((proxy.address() as AddressInfo).address).toBe("127.0.0.1");
		const response = await fetch(`${origin}${path}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("transfer-encoding")).toBeNull();
		const body = await response.text();
		expect(Number(response.headers.get("content-length"))).toBe(
			Buffer.byteLength(body),
		);
		expect(JSON.parse(body)).toEqual({
			url: `${origin}${chunkPath}`,
			maxFileSize: 1024,
		});
	},
);

it("forwards POST paths, bodies and authorization unchanged", async () => {
	let received: unknown;
	respond = (req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			received = {
				method: req.method,
				path: req.url,
				authorization: req.headers.authorization,
				host: req.headers.host,
				contentType: req.headers["content-type"],
				body: Buffer.concat(chunks),
			};
			res.writeHead(201, { "x-upstream": "preserved" });
			res.end(advertisedUrl);
		});
	};
	const body = Buffer.from([0, 1, 127, 128, 255]);
	const response = await fetch(`${origin}${chunkPath}?part=1`, {
		method: "POST",
		headers: {
			authorization: "Bearer fake-local-test-token",
			"content-type": "application/octet-stream",
		},
		body,
	});
	const upstreamPort = (upstream.address() as AddressInfo).port;
	expect(received).toEqual({
		method: "POST",
		path: `${chunkPath}?part=1`,
		authorization: "Bearer fake-local-test-token",
		host: `127.0.0.1:${upstreamPort}`,
		contentType: "application/octet-stream",
		body,
	});
	expect(response.status).toBe(201);
	expect(response.headers.get("x-upstream")).toBe("preserved");
	expect(await response.text()).toBe(advertisedUrl);
});

it("leaves JSON URLs on other GET paths unchanged", async () => {
	const response = await fetch(`${origin}/api/0/projects/test/releases/`);
	expect(await response.json()).toEqual({
		url: advertisedUrl,
		maxFileSize: 1024,
	});
});

it.each([
	[200, "<html>Not JSON</html>"],
	[200, '{"url":"invalid URL"}'],
	[503, JSON.stringify({ url: advertisedUrl, detail: "Unavailable" })],
])(
	"passes a chunk-upload response through unchanged: %s %s",
	async (status, body) => {
		respond = (_req, res) => {
			res.writeHead(status, {
				"content-type": "text/plain",
				"content-length": Buffer.byteLength(body),
				"x-upstream": "preserved",
			});
			res.end(body);
		};
		const response = await fetch(`${origin}${chunkPath}`);
		expect(response.status).toBe(status);
		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(response.headers.get("content-length")).toBe(
			String(Buffer.byteLength(body)),
		);
		expect(response.headers.get("x-upstream")).toBe("preserved");
		expect(await response.text()).toBe(body);
	},
);
