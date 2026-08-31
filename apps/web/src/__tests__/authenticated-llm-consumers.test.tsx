// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { post, updatePrompt } = vi.hoisted(() => ({
	post: vi.fn(),
	updatePrompt: vi.fn(),
}));

vi.mock("@/integrations/api/client", () => ({
	api: { post },
}));

vi.mock("@/integrations/api/hooks", () => ({
	useUpdatePlaylistPrompt: () => updatePrompt,
}));

import { DirectionSteering } from "../components/autoplayer/DirectionSteering";
import { QuickRequest } from "../components/autoplayer/QuickRequest";

describe("authenticated LLM consumers", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("sends quick-request enhancement through the authenticated API client", async () => {
		post.mockResolvedValue({ result: "enhanced request" });
		const onRequest = vi.fn();
		const view = render(
			createElement(QuickRequest, {
				onRequest,
				provider: "openrouter",
				model: "auto",
			}),
		);

		fireEvent.change(
			view.getByPlaceholderText("ACOUSTIC COVER OF BOHEMIAN RHAPSODY..."),
			{ target: { value: "acoustic cover" } },
		);
		fireEvent.click(view.getByRole("button", { name: "SEND" }));

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/autoplayer/enhance-request", {
				request: "acoustic cover",
				provider: "openrouter",
				model: "auto",
			});
		});
		expect(onRequest).toHaveBeenCalledWith("enhanced request");
	});

	it("sends direction refinement through the authenticated API client", async () => {
		post.mockResolvedValue({ result: "refined prompt" });
		updatePrompt.mockResolvedValue(undefined);
		const view = render(
			createElement(DirectionSteering, {
				playlist: {
					id: "playlist-1",
					prompt: "original prompt",
					llmProvider: "openrouter",
					llmModel: "auto",
					promptEpoch: 0,
					steerHistory: [],
				},
			}),
		);

		fireEvent.change(
			view.getByPlaceholderText(
				"NO MORE LOVE SONGS... / MORE BASS... / MORE TECHNO...",
			),
			{ target: { value: "more bass" } },
		);
		fireEvent.click(view.getByRole("button", { name: "STEER" }));

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/autoplayer/refine-prompt", {
				currentPrompt: "original prompt",
				direction: "more bass",
				provider: "openrouter",
				model: "auto",
			});
		});
		expect(updatePrompt).toHaveBeenCalledWith({
			id: "playlist-1",
			prompt: "refined prompt",
		});
	});
});
