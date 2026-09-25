import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadAceAudio } from "../external/storage";

let server: http.Server;
let baseUrl: string;
let tmpDir: string;

beforeAll(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ace-download-"));
	server = http.createServer((req, res) => {
		if (req.url === "/small") {
			res.end("abc");
		} else if (req.url === "/declared-large") {
			res.writeHead(200, { "content-length": "1000" });
			res.end("x".repeat(1000));
		} else if (req.url === "/chunked-large") {
			res.write("x".repeat(8));
			res.end("x".repeat(8));
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("downloadAceAudio", () => {
	it("writes a response within the size limit", async () => {
		const target = path.join(tmpDir, "small.mp3");
		await downloadAceAudio(`${baseUrl}/small`, target, 10);
		expect(fs.readFileSync(target, "utf8")).toBe("abc");
	});

	it("rejects a declared oversized response without writing", async () => {
		const target = path.join(tmpDir, "declared.mp3");
		await expect(
			downloadAceAudio(`${baseUrl}/declared-large`, target, 10),
		).rejects.toThrow("too large");
		expect(fs.existsSync(target)).toBe(false);
	});

	it("stops a streamed response at the limit and removes the partial file", async () => {
		const target = path.join(tmpDir, "chunked.mp3");
		await expect(
			downloadAceAudio(`${baseUrl}/chunked-large`, target, 10),
		).rejects.toThrow("too large");
		expect(fs.existsSync(target)).toBe(false);
	});

	it("reports HTTP errors", async () => {
		await expect(
			downloadAceAudio(`${baseUrl}/missing`, path.join(tmpDir, "missing.mp3")),
		).rejects.toThrow("Failed to download audio: 404");
	});
});
