import { describe, expect, it } from "vitest";
import {
	formatElapsed,
	formatMs,
	formatTime,
	formatTimeAgo,
	isGenerating,
	isPlayable,
} from "../lib/format-time";

describe("formatTime", () => {
	it("formats 0 seconds", () => {
		expect(formatTime(0)).toBe("0:00");
	});
	it("formats seconds under a minute", () => {
		expect(formatTime(5)).toBe("0:05");
		expect(formatTime(59)).toBe("0:59");
	});
	it("formats minutes and seconds", () => {
		expect(formatTime(61)).toBe("1:01");
		expect(formatTime(125)).toBe("2:05");
	});
	it("floors fractional seconds", () => {
		expect(formatTime(90.7)).toBe("1:30");
	});
});

describe("formatElapsed", () => {
	it("formats sub-minute durations", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(5000)).toBe("5s");
		expect(formatElapsed(59999)).toBe("59s");
	});
	it("formats minutes and seconds", () => {
		expect(formatElapsed(60000)).toBe("1m 0s");
		expect(formatElapsed(125000)).toBe("2m 5s");
	});
});

describe("formatTimeAgo", () => {
	it("formats seconds ago", () => {
		const now = Date.now();
		expect(formatTimeAgo(now - 5000)).toBe("5s ago");
	});
	it("formats minutes ago", () => {
		const now = Date.now();
		expect(formatTimeAgo(now - 180000)).toBe("3min ago");
	});
	it("formats hours ago", () => {
		const now = Date.now();
		expect(formatTimeAgo(now - 7200000)).toBe("2h ago");
	});
});

describe("formatMs", () => {
	it("formats sub-second values", () => {
		expect(formatMs(500)).toBe("500ms");
		expect(formatMs(0)).toBe("0ms");
	});
	it("formats seconds", () => {
		expect(formatMs(5000)).toBe("5s");
		expect(formatMs(59000)).toBe("59s");
	});
	it("formats minutes and seconds", () => {
		expect(formatMs(60000)).toBe("1m 0s");
		expect(formatMs(125000)).toBe("2m 5s");
	});
});

describe("isGenerating", () => {
	it("returns true for pipeline statuses", () => {
		expect(isGenerating("pending")).toBe(true);
		expect(isGenerating("generating_metadata")).toBe(true);
		expect(isGenerating("metadata_ready")).toBe(true);
		expect(isGenerating("submitting_to_ace")).toBe(true);
		expect(isGenerating("generating_audio")).toBe(true);
		expect(isGenerating("saving")).toBe(true);
	});
	it("returns false for terminal statuses", () => {
		expect(isGenerating("ready")).toBe(false);
		expect(isGenerating("played")).toBe(false);
		expect(isGenerating("error")).toBe(false);
		expect(isGenerating("retry_pending")).toBe(false);
	});
});

describe("isPlayable", () => {
	it("returns true for ready and played", () => {
		expect(isPlayable("ready")).toBe(true);
		expect(isPlayable("played")).toBe(true);
	});
	it("returns false for non-playable statuses", () => {
		expect(isPlayable("pending")).toBe(false);
		expect(isPlayable("error")).toBe(false);
		expect(isPlayable("generating_audio")).toBe(false);
	});
});
