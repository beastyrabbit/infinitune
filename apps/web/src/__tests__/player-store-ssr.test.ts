// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("keeps default player settings during SSR without touching localStorage", async () => {
	const storageAccess = vi.fn();
	vi.stubGlobal("localStorage", undefined);
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get: storageAccess,
	});

	const { playerStore, setVolume, toggleMute } = await import(
		"../lib/player-store"
	);
	expect(playerStore.state).toMatchObject({ volume: 0.8, isMuted: false });
	setVolume(0.5);
	toggleMute();
	expect(playerStore.state).toMatchObject({ volume: 0.5, isMuted: true });
	expect(storageAccess).not.toHaveBeenCalled();
});
