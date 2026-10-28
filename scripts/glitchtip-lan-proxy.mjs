// GlitchTip advertises a public chunk-upload URL protected by Pangolin SSO.
// Forward to its LAN API and keep chunk uploads on this loopback proxy.
// Usage: node glitchtip-lan-proxy.mjs <upstream-origin> <port>
import http from "node:http";
import { pathToFileURL } from "node:url";

export function createGlitchtipLanProxy(upstream, port) {
	const server = http.createServer((req, res) => {
		const forward = http.request(
			{
				host: upstream.hostname,
				port: upstream.port,
				method: req.method,
				path: req.url,
				headers: { ...req.headers, host: upstream.host },
			},
			(upstreamRes) => {
				const status = upstreamRes.statusCode ?? 502;
				if (
					req.method !== "GET" ||
					!/\/chunk-upload\/?$/.test(new URL(req.url, upstream).pathname) ||
					status < 200 ||
					status >= 300
				) {
					res.writeHead(status, upstreamRes.headers);
					upstreamRes.pipe(res);
					return;
				}

				const chunks = [];
				upstreamRes.on("data", (chunk) => chunks.push(chunk));
				upstreamRes.on("end", () => {
					let body = Buffer.concat(chunks);
					let headers = upstreamRes.headers;
					try {
						const options = JSON.parse(body.toString());
						if (typeof options?.url === "string") {
							const path = new URL(options.url).pathname;
							options.url = `http://127.0.0.1:${server.address().port}${path}`;
							body = Buffer.from(JSON.stringify(options));
							headers = { ...headers, "content-length": body.length };
							delete headers["transfer-encoding"];
						}
					} catch {
						// Keep non-JSON or malformed responses unchanged.
					}
					res.writeHead(status, headers);
					res.end(body);
				});
			},
		);
		forward.on("error", () => {
			if (res.headersSent) {
				res.destroy();
			} else {
				res.writeHead(502);
				res.end();
			}
		});
		req.pipe(forward);
	});
	return server.listen(port, "127.0.0.1");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	createGlitchtipLanProxy(new URL(process.argv[2]), Number(process.argv[3]));
}
