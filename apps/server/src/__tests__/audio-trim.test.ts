import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile }));

import {
	FFMPEG_PASS_TIMEOUT_MS,
	trimTrailingSilence,
} from "../external/audio-processing";

type Callback = (error: Error | null, result?: object) => void;

describe("trimTrailingSilence", () => {
	let dir: string;
	let audioFile: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "infinitune-trim-"));
		audioFile = path.join(dir, ".audio-pending.mp3");
		fs.writeFileSync(audioFile, "original audio");
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("bounds each ffmpeg pass and cleans up a trim that times out", async () => {
		execFile.mockImplementation(
			(_cmd: string, args: string[], _options: object, callback: Callback) => {
				if (args.includes("null")) {
					// Pass 1 finds 10 seconds of trailing silence.
					callback(null, {
						stdout: "",
						stderr: "Duration: 00:00:40.00, start\nsilence_start: 30.0\n",
					});
					return;
				}
				// Pass 2 writes part of its output, then is killed by the timeout.
				fs.writeFileSync(args[args.length - 1], "partial");
				callback(Object.assign(new Error("killed"), { killed: true }));
			},
		);

		const result = await trimTrailingSilence(audioFile);

		expect(result.trimmed).toBe(false);
		expect(execFile).toHaveBeenCalledTimes(2);
		for (const call of execFile.mock.calls) {
			expect(call[2]).toMatchObject({ timeout: FFMPEG_PASS_TIMEOUT_MS });
		}
		expect(fs.readFileSync(audioFile, "utf8")).toBe("original audio");
		expect(fs.readdirSync(dir)).toEqual([".audio-pending.mp3"]);
	});
});
