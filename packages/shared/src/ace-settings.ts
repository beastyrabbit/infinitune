export const ACE_QUALITY_DEFAULT_MODEL = "acestep-v15-xl-turbo";

export const ACE_KNOWN_MODELS = [
	"acestep-v15-xl-turbo",
	"acestep-v15-xl-sft",
	"acestep-v15-xl-base",
	"acestep-v15-base",
	"acestep-v15-sft",
	"acestep-v15-turbo",
] as const;

export const ACE_DCW_MODES = ["low", "high", "double", "pix"] as const;

export type AceKnownModel = (typeof ACE_KNOWN_MODELS)[number];
export type AceDcwMode = (typeof ACE_DCW_MODES)[number];

export const ACE_DCW_DEFAULTS = {
	enabled: true,
	mode: "double" as AceDcwMode,
	scaler: 0.05,
	highScaler: 0.02,
	wavelet: "haar",
} as const;

export const ACE_VAE_DEFAULT = "official";

export const ACE_VAE_OPTIONS = [
	{ value: "official", label: "OFFICIAL" },
	{ value: "scragvae", label: "SCRAGVAE" },
] as const;

const ACE_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

function normalizeAceModelValue(value: string | null | undefined): string {
	const normalized = value?.trim() ?? "";
	const lower = normalized.toLowerCase();
	return normalized === "__default__" || lower === "default" ? "" : normalized;
}

function isSafeAceModelId(value: string): boolean {
	return (
		value.length <= 128 &&
		ACE_MODEL_ID_PATTERN.test(value) &&
		!value.includes("..") &&
		!value.includes("//") &&
		!value.includes("\\") &&
		!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
	);
}

export function isValidAceModel(value: string | null | undefined): boolean {
	const normalized = normalizeAceModelValue(value);
	return normalized === "" || isSafeAceModelId(normalized);
}

export function normalizeAceModel(value: string | null | undefined): string {
	const normalized = normalizeAceModelValue(value);
	return normalized && isSafeAceModelId(normalized) ? normalized : "";
}

export function normalizeAceDcwScaler(
	value: string | number | null | undefined,
	fallback: number,
): number {
	const normalizedFallback = Number.isFinite(fallback)
		? Math.min(1, Math.max(0, fallback))
		: 0;
	const parsed =
		typeof value === "number"
			? value
			: value?.trim()
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isFinite(parsed)) return normalizedFallback;
	return Math.min(1, Math.max(0, parsed));
}

export function getAceModelKey(value: string | null | undefined): string {
	return normalizeAceModel(value).replace(/^acestep\//, "");
}

export function resolveAceModelSetting(
	value: string | null | undefined,
	hasExplicitValue: boolean,
): string {
	const normalized = normalizeAceModel(value);
	return hasExplicitValue
		? normalized
		: normalized || ACE_QUALITY_DEFAULT_MODEL;
}

export function normalizeAceVaeCheckpoint(
	value: string | null | undefined,
): string {
	const normalized = value?.trim() ?? "";
	return normalized === "" || normalized === "__default__"
		? ACE_VAE_DEFAULT
		: normalized;
}

export function isAceXlModel(value: string | null | undefined): boolean {
	return getAceModelKey(value).includes("-xl-");
}

export function resolveAceQualityDefaultModel(
	models: Array<{ name: string; is_default?: boolean }> = [],
): string {
	const xlTurbo = models.find(
		(model) => getAceModelKey(model.name) === ACE_QUALITY_DEFAULT_MODEL,
	);
	if (xlTurbo) {
		return xlTurbo.name;
	}
	const serverDefault = models.find((model) => model.is_default)?.name;
	return normalizeAceModel(serverDefault) || ACE_QUALITY_DEFAULT_MODEL;
}
