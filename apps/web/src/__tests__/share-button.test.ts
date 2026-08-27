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

	it("creates a permanent link directly and copies its public URL", async () => {
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
		fireEvent.click(view.getByRole("button"));

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/share", {
				resourceType: "playlist",
				resourceId: "playlist-1",
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

	it("labels an expiring anonymous link as timed", async () => {
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
		fireEvent.click(view.getByRole("button"));

		await waitFor(() => {
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
