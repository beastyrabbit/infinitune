import { normalizeImageProvider } from "@infinitune/shared/inference-sh-image-models";
import { callCodexImagegenCover } from "./codex-imagegen";
import { callInferenceShImageGen } from "./inference-sh";

export interface CoverResult {
	imageBase64: string;
	format: string;
}

export async function generateCover(options: {
	coverPrompt: string;
	provider: string;
	model?: string;
	signal?: AbortSignal;
}): Promise<CoverResult | null> {
	const { coverPrompt, model, signal } = options;
	const provider = normalizeImageProvider(options.provider);

	const fullPrompt = [
		"Square front album cover artwork for a physical CD jewel case.",
		"Use a 1:1 composition with crisp release-art typography when the prompt names a band and album.",
		"Render only the requested band and album title text; do not add extra words, logos, watermarks, UI, or case mockups.",
		coverPrompt,
	].join(" ");

	if (provider === "codex-imagegen") {
		const result = await callCodexImagegenCover({
			prompt: fullPrompt,
			signal,
		});
		return { imageBase64: result.base64, format: result.format };
	}

	const result = await callInferenceShImageGen({
		model,
		prompt: fullPrompt,
		signal,
	});
	return { imageBase64: result.base64, format: result.format };
}
