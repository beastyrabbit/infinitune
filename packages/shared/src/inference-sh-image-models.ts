export interface InferenceShImageModelOption {
	id: string;
	name: string;
	priceLabel: string;
	pricePerImageUsd?: number;
	description: string;
}

export const DEFAULT_INFERENCE_SH_IMAGE_MODEL = "pruna/flux-klein-4b";

export const INFERENCE_SH_IMAGE_MODELS: InferenceShImageModelOption[] = [
	{
		id: "pruna/flux-klein-4b",
		name: "FLUX Klein 4B",
		priceLabel: "$0.0001/img",
		pricePerImageUsd: 0.0001,
		description: "Ultra-cheap fast cover drafts",
	},
	{
		id: "pruna/wan-image-small",
		name: "Wan Image Small",
		priceLabel: "Budget",
		description: "Fast efficient text-to-image for rapid batches",
	},
	{
		id: "pruna/z-image-turbo",
		name: "Z-Image Turbo",
		priceLabel: "Budget",
		description: "Low-latency turbo image generation",
	},
	{
		id: "pruna/p-image",
		name: "P-Image",
		priceLabel: "Economy",
		description: "Fast text-to-image with prompt enhancement",
	},
	{
		id: "pruna/qwen-image-fast",
		name: "Qwen Image Fast",
		priceLabel: "Economy",
		description: "Fast Qwen-based generation with creativity control",
	},
];

export function normalizeInferenceShImageModel(
	model: string | null | undefined,
): string {
	const trimmed = model?.trim();
	if (!trimmed) return DEFAULT_INFERENCE_SH_IMAGE_MODEL;
	return INFERENCE_SH_IMAGE_MODELS.some((entry) => entry.id === trimmed)
		? trimmed
		: DEFAULT_INFERENCE_SH_IMAGE_MODEL;
}
