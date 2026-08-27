import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const entrypoint = new URL("../../../../docker-entrypoint.sh", import.meta.url)
	.pathname;
const temporaryDirectories: string[] = [];

function runEntrypoint(appOrigin: string): number {
	const directory = mkdtempSync(join(tmpdir(), "infinitune-entrypoint-"));
	temporaryDirectories.push(directory);
	const nodeShim = join(directory, "node");
	writeFileSync(
		nodeShim,
		`#!/bin/sh\nif [ "$1" = "-e" ]; then\n  exec ${JSON.stringify(process.execPath)} "$@"\nfi\nexit 0\n`,
	);
	chmodSync(nodeShim, 0o755);

	try {
		execFileSync(entrypoint, {
			env: {
				...process.env,
				APP_ORIGIN: appOrigin,
				PATH: `${directory}:${process.env.PATH ?? ""}`,
				PROCESS_TYPE: "frontend",
			},
			stdio: "ignore",
		});
		return 0;
	} catch (error) {
		return typeof error === "object" && error && "status" in error
			? Number(error.status)
			: -1;
	}
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("production APP_ORIGIN validation", () => {
	it.each([
		"https://music.example.com",
		"https://music.example.com/",
		"http://localhost:5173",
	])("accepts an origin-only HTTP(S) URL: %s", (origin) => {
		expect(runEntrypoint(origin)).toBe(0);
	});

	it.each([
		"https://music.example.com?",
		"https://music.example.com#",
		"https://@music.example.com",
		"https://music.example.com/a/..",
		"https://music.example.com/path",
	])("rejects a raw value that is not only an origin: %s", (origin) => {
		expect(runEntrypoint(origin)).toBe(1);
	});
});
