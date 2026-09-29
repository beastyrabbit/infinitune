import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ unitDir: "" }));

vi.mock("./lib/paths", async (importOriginal) => ({
	...(await importOriginal<typeof import("./lib/paths")>()),
	getSystemdUserDir: () => fixtures.unitDir,
}));
vi.mock("./config", () => ({
	loadConfig: () => ({
		serverUrl: "http://localhost:5175",
		deviceToken: "test-only-device-token",
	}),
	patchConfig: vi.fn(),
}));
vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
	spawnSync: vi.fn(() => ({ status: 0, stderr: "" })),
}));

const originalArgv = process.argv;

afterEach(() => {
	process.argv = originalArgv;
	vi.restoreAllMocks();
	if (fixtures.unitDir) {
		fs.rmSync(fixtures.unitDir, { recursive: true, force: true });
		fixtures.unitDir = "";
	}
});

it.each([false, true])(
	"keeps device tokens private when installing a service, existing unit: %s",
	async (existingUnit) => {
		vi.resetModules();
		fixtures.unitDir = fs.mkdtempSync(path.join(os.tmpdir(), "infi-service-"));
		const unitPath = path.join(fixtures.unitDir, "infinitune-daemon.service");
		if (existingUnit) {
			fs.writeFileSync(unitPath, "old unit");
			fs.chmodSync(unitPath, 0o644);
		}
		const writeFile = fs.writeFileSync;
		const permissionsAtWrite: number[] = [];
		vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
			if (typeof file === "number") {
				permissionsAtWrite.push(fs.fstatSync(file).mode & 0o777);
			}
			writeFile(file, data, options);
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
		process.argv = [process.execPath, "cli.ts", "service", "install"];

		await import("./cli");

		expect(permissionsAtWrite).toEqual([0o600]);
		expect(fs.statSync(unitPath).mode & 0o777).toBe(0o600);
		expect(fs.readFileSync(unitPath, "utf8")).toContain(
			'--device-token "test-only-device-token"',
		);
	},
);
