import { describe, expect, it } from "vitest";
import { getOpenRouterCredentialUiMode } from "../components/autoplayer/settings/SettingsTabNetwork";

describe("OpenRouter credential UI mode", () => {
	it.each([
		["owner", { canManage: true }],
		["setup", { setupAllowed: true }],
		["claim", { claimRequired: true }],
		["external", { managedExternally: true }],
		["shared", {}],
	] as const)("selects %s controls", (expected, overrides) => {
		expect(
			getOpenRouterCredentialUiMode({
				configured: expected !== "setup",
				source: expected === "external" ? "environment" : "stored",
				canManage: false,
				setupAllowed: false,
				claimRequired: false,
				managedExternally: false,
				...overrides,
			}),
		).toBe(expected);
	});
});
