// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setVolume } = vi.hoisted(() => ({ setVolume: vi.fn() }));

vi.mock("@/lib/player-store", () => ({
	setVolume,
	toggleMute: vi.fn(),
}));

import {
	OneshotTransport,
	OneshotVolume,
} from "../components/autoplayer/OneshotPlayback";

function renderTransport(isCurrentSong: boolean, onSeek = vi.fn()) {
	const view = render(
		createElement(OneshotTransport, {
			isCurrentSong,
			isPlaying: true,
			currentTime: 12.4,
			audioDuration: 40,
			onPlayPause: vi.fn(),
			onSeek,
			playButtonClassName: "",
			progressBarClassName: "h-full",
		}),
	);
	return { slider: view.getByRole("slider", { name: "Seek" }), onSeek };
}

describe("oneshot playback sliders", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("seeks the playing song to the slider value", () => {
		const { slider, onSeek } = renderTransport(true);

		expect(slider.getAttribute("aria-valuetext")).toBe("0:12 of 0:40");
		fireEvent.change(slider, { target: { value: "30" } });

		expect(onSeek).toHaveBeenCalledWith(30);
	});

	it("disables seeking while another song is playing", () => {
		const { slider } = renderTransport(false);

		expect((slider as HTMLInputElement).disabled).toBe(true);
		expect(slider.getAttribute("aria-valuetext")).toBe("0:00 of --:--");
	});

	it("sets the volume and reports it as a percentage", () => {
		const view = render(
			createElement(OneshotVolume, { volume: 0.8, isMuted: false }),
		);
		const slider = view.getByRole("slider", { name: "Volume" });

		expect(slider.getAttribute("aria-valuetext")).toBe("80%");
		fireEvent.change(slider, { target: { value: "0.25" } });

		expect(setVolume).toHaveBeenCalledWith(0.25);
	});

	it("shows a muted player at zero volume", () => {
		const view = render(
			createElement(OneshotVolume, { volume: 0.8, isMuted: true }),
		);

		expect(
			view
				.getByRole("slider", { name: "Volume" })
				.getAttribute("aria-valuetext"),
		).toBe("0%");
	});
});
