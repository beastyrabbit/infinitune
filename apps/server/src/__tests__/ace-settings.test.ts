import {
	ACE_DCW_DEFAULTS,
	getAceModelKey,
	isValidAceModel,
	normalizeAceDcwScaler,
	normalizeAceModel,
	parseBooleanSetting,
} from "@infinitune/shared/ace-settings";
import { describe, expect, it } from "vitest";

describe("ace-settings", () => {
	it("clamps DCW scalers to the ACE-Step API range", () => {
		expect(normalizeAceDcwScaler("0.5", ACE_DCW_DEFAULTS.scaler)).toBe(0.5);
		expect(normalizeAceDcwScaler("2", ACE_DCW_DEFAULTS.scaler)).toBe(1);
		expect(normalizeAceDcwScaler("-0.1", ACE_DCW_DEFAULTS.scaler)).toBe(0);
		expect(normalizeAceDcwScaler("nope", ACE_DCW_DEFAULTS.scaler)).toBe(
			ACE_DCW_DEFAULTS.scaler,
		);
	});

	it("rejects unsafe ACE model identifiers", () => {
		expect(isValidAceModel("acestep-v15-xl-turbo")).toBe(true);
		expect(normalizeAceModel("https://example.test/model")).toBe("");
		expect(isValidAceModel("../model")).toBe(false);
	});

	it("deduplicates ACE model identifiers case-insensitively", () => {
		expect(getAceModelKey("Acestep/ACESTEP-V15-XL-TURBO")).toBe(
			"acestep-v15-xl-turbo",
		);
	});

	it("parses persisted boolean settings with a fallback", () => {
		expect(parseBooleanSetting("true", false)).toBe(true);
		expect(parseBooleanSetting("false", true)).toBe(false);
		expect(parseBooleanSetting(undefined, true)).toBe(true);
	});
});
