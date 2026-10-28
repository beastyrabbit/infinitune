import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { expect, test } from "@playwright/test";

for (const signal of ["SIGTERM", "SIGINT"] as const) {
	test(`built Nitro server flushes pending SSR errors on ${signal}`, async () => {
		let release!: ServerResponse;
		let receive!: (body: string) => void;
		const envelope = new Promise<string>((resolve) => { receive = resolve; });
		const sink = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			release = response;
			receive(Buffer.concat(chunks).toString("utf8"));
		});
		sink.listen(0, "127.0.0.1");
		await once(sink, "listening");
		const address = sink.address();
		if (!address || typeof address === "string") throw new Error("No test sink port");
		const child = fork(new URL("./fixtures/nitro-shutdown.mjs", import.meta.url), {
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			env: {
				...process.env,
				CI: "",
				TEST: "",
				VITEST: "false",
				NODE_ENV: "production",
				PORT: "0",
				HOST: "127.0.0.1",
				TELEMETRY_ENABLED: "true",
				GLITCHTIP_DSN: `http://public@127.0.0.1:${address.port}/1`,
				GLITCHTIP_TRACES_SAMPLE_RATE: "0",
				UMAMI_URL: "",
				UMAMI_WEBSITE_ID: "",
			},
		});
		const messages: Array<{ type: string; timeout?: number; result?: boolean }> = [];
		child.on("message", (message) => messages.push(message as typeof messages[number]));
		const exited = once(child, "exit");
		try {
			await expect.poll(() => messages.some((message) => message.type === "ready")).toBe(true);
			child.send("capture");
			await expect.poll(() => messages.some((message) => message.type === "captured")).toBe(true);
			child.kill(signal);
			expect(await envelope).toContain("Nitro shutdown fixture");
			expect(child.exitCode).toBeNull();
			release.end("{}");
			await exited;
			expect(messages.filter((message) => message.type === "flushing")).toEqual([
				{ type: "flushing", timeout: 1500 },
			]);
			expect(messages).toContainEqual({ type: "flushed", result: true });
			expect(child.exitCode).toBe(0);
		} finally {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			sink.closeAllConnections();
			sink.close();
		}
	});
}
