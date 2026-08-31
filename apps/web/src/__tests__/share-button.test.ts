// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { post, success, warning } = vi.hoisted(() => ({
	post: vi.fn(),
	success: vi.fn(),
	warning: vi.fn(),
}));

vi.mock("@/integrations/api/client", () => ({
	api: { post },
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), success, warning },
}));

import { ShareButton } from "../components/autoplayer/ShareButton";

describe("ShareButton", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("creates a permanent link only after an explicit choice", async () => {
		post.mockResolvedValue({ token: "share-token", expiresAt: null });
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});

		const view = render(
			createElement(ShareButton, {
				resourceType: "playlist",
				resourceId: "playlist-1",
			}),
		);
		fireEvent.pointerDown(view.getByRole("button"), {
			button: 0,
			ctrlKey: false,
		});
		expect(post).not.toHaveBeenCalled();
		fireEvent.click(
			await view.findByRole("menuitem", { name: /keep permanently/i }),
		);

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/share", {
				resourceType: "playlist",
				resourceId: "playlist-1",
				permanent: true,
			});
		});
		expect(writeText).toHaveBeenCalledWith(
			"http://localhost:3000/share/share-token",
		);
		expect(success).toHaveBeenCalledOnce();
		expect(success).toHaveBeenCalledWith(
			"Permanent share link copied",
			expect.objectContaining({
				description: expect.stringContaining(
					"Permanent links keep temporary music permanently",
				),
			}),
		);
	});

	it("requests and labels a 30-day share link as timed", async () => {
		const expiresAt = Date.now() + 60_000;
		post.mockResolvedValue({ token: "timed-token", expiresAt });
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
		});

		const view = render(
			createElement(ShareButton, {
				resourceType: "song",
				resourceId: "song-1",
			}),
		);
		fireEvent.pointerDown(view.getByRole("button"), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(
			await view.findByRole("menuitem", { name: "Share for 30 days" }),
		);

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/share", {
				resourceType: "song",
				resourceId: "song-1",
				expiresInDays: 30,
			});
			expect(warning).toHaveBeenCalledWith(
				"Timed share link ready. Copy it manually.",
				expect.objectContaining({
					description: expect.stringContaining(
						new Date(expiresAt).toLocaleString(),
					),
				}),
			);
		});
	});
});
