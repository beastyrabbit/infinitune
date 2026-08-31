import {
	ACE_DCW_DEFAULTS,
	ACE_GENERATION_DEFAULTS,
	ACE_QUALITY_DEFAULT_MODEL,
	getAceModelKey,
	isValidAceModel,
	normalizeAceDcwScaler,
	normalizeAceGuidanceScale,
	normalizeAceModel,
	normalizeAceSamplerMode,
	normalizeAceShift,
	normalizeAceVelocityEmaFactor,
	normalizeAceVelocityNormThreshold,
	parseBooleanSetting,
	resolveAceModelSetting,
} from "@infinitune/shared/ace-settings";
import { describe, expect, it } from "vitest";

describe("ace-settings", () => {
	it("defines the complete Preset M defaults", () => {
		expect(ACE_QUALITY_DEFAULT_MODEL).toBe("acestep-v15-xl-sft");
		expect(ACE_GENERATION_DEFAULTS).toMatchObject({
			inferenceSteps: 50,
			guidanceScale: 7,
			inferMethod: "ode",
			samplerMode: "heun",
			shift: 1,
			velocityNormThreshold: 2,
			velocityEmaFactor: 0.1,
			useAdg: false,
			thinking: false,
		});
		expect(ACE_DCW_DEFAULTS.enabled).toBe(false);
	});

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

	it("distinguishes the Preset M fallback from an explicit server default", () => {
		expect(resolveAceModelSetting(undefined, false)).toBe(
			ACE_QUALITY_DEFAULT_MODEL,
		);
		expect(resolveAceModelSetting("", true)).toBe("");
	});

	it("parses persisted boolean settings with a fallback", () => {
		expect(parseBooleanSetting("true", false)).toBe(true);
		expect(parseBooleanSetting("false", true)).toBe(false);
		expect(parseBooleanSetting(undefined, true)).toBe(true);
	});

	it("normalizes and bounds Preset M settings", () => {
		expect(normalizeAceGuidanceScale("20")).toBe(15);
		expect(normalizeAceGuidanceScale("invalid")).toBe(7);
		expect(normalizeAceShift("0")).toBe(1);
		expect(normalizeAceShift("9")).toBe(5);
		expect(normalizeAceVelocityNormThreshold("-2")).toBe(0);
		expect(normalizeAceVelocityNormThreshold("7")).toBe(5);
		expect(normalizeAceVelocityEmaFactor("-1")).toBe(0);
		expect(normalizeAceVelocityEmaFactor("0.8")).toBe(0.5);
		expect(normalizeAceSamplerMode("EULER")).toBe("euler");
		expect(normalizeAceSamplerMode("unsupported")).toBe("heun");
	});
});
