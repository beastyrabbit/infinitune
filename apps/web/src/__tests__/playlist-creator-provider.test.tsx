// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/api/client", () => ({
	api: { post: vi.fn() },
	getRequestErrorMessage: (error: unknown) => String(error),
	isTimeoutError: () => false,
}));

vi.mock("@/integrations/api/hooks", () => ({
	useAutoplayerCodexModels: () => [],
	useAutoplayerOpenRouterModels: () => [
		{ name: "auto", displayName: "Auto", type: "text" },
	],
	useSettings: () => undefined,
}));

import { PlaylistCreator } from "../components/autoplayer/PlaylistCreator";

describe("PlaylistCreator provider models", () => {
	afterEach(() => cleanup());

	it("keeps the Codex fallback separate from OpenRouter models", async () => {
		const view = render(
			createElement(PlaylistCreator, {
				onCreatePlaylist: vi.fn(),
				onOpenSettings: vi.fn(),
			}),
		);

		const codexInput = await waitFor(() =>
			view.getByPlaceholderText("GPT-5.2"),
		);
		expect(codexInput.getAttribute("list")).toBeNull();

		fireEvent.click(view.getByRole("button", { name: "OPENROUTER" }));
		const openrouterInput = await waitFor(() =>
			view.getByPlaceholderText("AUTO"),
		);
		expect(openrouterInput.getAttribute("list")).toBeTruthy();
	});
});
