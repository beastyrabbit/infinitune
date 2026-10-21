// @vitest-environment jsdom
import { telemetryConfig } from "@infinitune/shared/telemetry";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getGlobalAudio, setCurrentSong } from "@/lib/player-store";
import { trackEvent } from "./browser";
import { Telemetry } from "./Telemetry";

vi.mock("./browser", () => ({ startAnalytics: vi.fn(), trackEvent: vi.fn() }));
vi.mock("./sentry", () => ({ startBrowserSentry: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	setCurrentSong(null);
});

it("counts song starts once across pause/resume and config changes, and counts subsequent starts", () => {
	const config = telemetryConfig({});
	const { rerender } = render(<Telemetry config={config} />);
	const audio = getGlobalAudio();
	const emit = (event: string) =>
		act(() => audio.dispatchEvent(new Event(event)));
	emit("play"); // No song selected yet.
	expect(trackEvent).not.toHaveBeenCalled();
	setCurrentSong("first");
	emit("play");
	emit("pause");
	emit("play");
	rerender(<Telemetry config={{ ...config }} />);
	emit("play");
	expect(trackEvent).toHaveBeenCalledExactlyOnceWith("song_play", {
		song_id: "first",
	});
	setCurrentSong("second");
	emit("play");
	setCurrentSong("first");
	emit("play");
	emit("ended");
	emit("play"); // Replay after completion.
	setCurrentSong(null);
	setCurrentSong("first");
	emit("play"); // Start again after stopping.
	expect(
		vi.mocked(trackEvent).mock.calls.filter(([name]) => name === "song_play"),
	).toHaveLength(5);
	expect(trackEvent).toHaveBeenCalledWith("song_complete", {
		song_id: "first",
	});
});
