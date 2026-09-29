import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { getConfigPath, loadConfig, saveConfig } from "./config";

const fixtures = vi.hoisted(() => ({ configRoot: "" }));

vi.mock("./lib/paths", () => ({
	getConfigRoot: () => fixtures.configRoot,
}));

afterEach(() => {
	vi.restoreAllMocks();
	if (fixtures.configRoot) {
		fs.rmSync(fixtures.configRoot, { recursive: true, force: true });
		fixtures.configRoot = "";
	}
});

it.each([false, true])(
	"keeps saved device tokens private, existing config: %s",
	(existingConfig) => {
		fixtures.configRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "infi-config-"),
		);
		const configPath = getConfigPath();
		const next = { ...loadConfig(), deviceToken: "test-only-device-token" };
		if (existingConfig) {
			fs.writeFileSync(configPath, "{}");
			fs.chmodSync(configPath, 0o644);
		}
		const writeFile = fs.writeFileSync;
		const permissionsAtWrite: number[] = [];
		vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
			if (typeof file === "number") {
				permissionsAtWrite.push(fs.fstatSync(file).mode & 0o777);
			}
			writeFile(file, data, options);
		});

		saveConfig(next);

		expect(permissionsAtWrite).toEqual([0o600]);
		expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
		expect(loadConfig()).toEqual(next);
	},
);
