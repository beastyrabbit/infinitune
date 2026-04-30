import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
	DEFAULT_INFERENCE_SH_IMAGE_MODEL,
	INFERENCE_SH_IMAGE_MODELS,
	type InferenceShImageModelOption,
	normalizeInferenceShImageModel,
} from "@infinitune/shared/inference-sh-image-models";

export {
	DEFAULT_INFERENCE_SH_IMAGE_MODEL,
	INFERENCE_SH_IMAGE_MODELS,
	type InferenceShImageModelOption,
};

const ANSI_ESC = String.fromCharCode(27);
const ANSI_CSI = String.fromCharCode(155);

function stripAnsi(value: string): string {
	return value
		.replace(new RegExp(`${ANSI_ESC}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
		.replace(new RegExp(`${ANSI_CSI}[0-?]*[ -/]*[@-~]`, "g"), "");
}

function buildInferenceShImageInput(
	model: string,
	prompt: string,
): Record<string, unknown> {
	if (model === "pruna/wan-image-small") {
		return {
			prompt,
			aspect_ratio: "1:1",
			juiced: true,
			num_outputs: 1,
		};
	}

	if (model === "pruna/z-image-turbo") {
		return {
			prompt,
			width: 1024,
			height: 1024,
			go_fast: true,
			num_inference_steps: 8,
			output_format: "png",
		};
	}

	if (model === "pruna/p-image") {
		return {
			prompt,
			aspect_ratio: "1:1",
			prompt_upsampling: true,
		};
	}

	if (model === "pruna/qwen-image-fast") {
		return {
			prompt,
			aspect_ratio: "1:1",
			creativity: 0.35,
		};
	}

	return {
		prompt,
		aspect_ratio: "1:1",
		output_megapixels: "1",
		output_format: "png",
		go_fast: true,
	};
}

function runInfsh(
	args: string[],
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
	const { signal, timeoutMs = 180_000 } = options;

	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			return;
		}

		const child = spawn("infsh", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		};

		const abort = () => {
			child.kill("SIGTERM");
			finish(new Error("Inference.sh generation aborted"));
		};

		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish(new Error("Inference.sh CLI timed out"));
		}, timeoutMs);

		signal?.addEventListener("abort", abort, { once: true });

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk;
		});

		child.on("error", (error) => {
			finish(new Error(`Failed to run infsh: ${error.message}`));
		});
		child.on("close", (code) => {
			if (code === 0) {
				finish();
				return;
			}
			const message = stripAnsi(
				stderr || stdout || `infsh exited with code ${code}`,
			).trim();
			finish(new Error(message || `infsh exited with code ${code}`));
		});
	});
}

function parseInfshJson(stdout: string): unknown {
	const cleaned = stripAnsi(stdout).trim();
	if (!cleaned) throw new Error("Inference.sh CLI returned no output");

	try {
		return JSON.parse(cleaned);
	} catch {
		const objectStart = cleaned.indexOf("{");
		const objectEnd = cleaned.lastIndexOf("}");
		if (objectStart >= 0 && objectEnd > objectStart) {
			return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
		}
		const arrayStart = cleaned.indexOf("[");
		const arrayEnd = cleaned.lastIndexOf("]");
		if (arrayStart >= 0 && arrayEnd > arrayStart) {
			return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
		}
		throw new Error("Inference.sh CLI returned non-JSON output");
	}
}

function extractImageReference(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const image = extractImageReference(item);
			if (image) return image;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;

	const data = value as Record<string, unknown>;
	for (const key of ["image", "images", "output", "result", "data"]) {
		const image = extractImageReference(data[key]);
		if (image) return image;
	}
	return null;
}

function inferImageFormat(
	reference: string,
	contentType?: string | null,
): string {
	if (contentType?.includes("image/webp")) return "webp";
	if (
		contentType?.includes("image/jpeg") ||
		contentType?.includes("image/jpg")
	) {
		return "jpg";
	}
	if (contentType?.includes("image/png")) return "png";

	const clean = reference.split("?")[0]?.toLowerCase() ?? "";
	if (clean.endsWith(".webp")) return "webp";
	if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpg";
	if (clean.endsWith(".png")) return "png";
	return "png";
}

async function imageReferenceToBase64(
	reference: string,
	signal?: AbortSignal,
): Promise<{ base64: string; format: string }> {
	if (reference.startsWith("data:image/")) {
		const [header, base64] = reference.split(",", 2);
		if (!base64) throw new Error("Invalid data URL returned by Inference.sh");
		const format = header.match(/^data:image\/([^;]+)/)?.[1] ?? "png";
		return { base64, format };
	}

	if (/^https?:\/\//i.test(reference)) {
		const response = await fetch(reference, { signal });
		if (!response.ok) {
			throw new Error(
				`Failed to download Inference.sh image: ${response.status}`,
			);
		}
		const arrayBuffer = await response.arrayBuffer();
		return {
			base64: Buffer.from(arrayBuffer).toString("base64"),
			format: inferImageFormat(reference, response.headers.get("content-type")),
		};
	}

	if (reference.startsWith("file://")) {
		const url = new URL(reference);
		const buffer = await readFile(url);
		return {
			base64: buffer.toString("base64"),
			format: inferImageFormat(url.pathname),
		};
	}

	if (/^[A-Za-z0-9+/=\s]+$/.test(reference) && reference.length > 500) {
		return { base64: reference.replace(/\s+/g, ""), format: "png" };
	}

	const buffer = await readFile(reference);
	return {
		base64: buffer.toString("base64"),
		format: inferImageFormat(reference),
	};
}

export async function callInferenceShImageGen(options: {
	model?: string;
	prompt: string;
	signal?: AbortSignal;
}): Promise<{ base64: string; format: string; model: string }> {
	const model = normalizeInferenceShImageModel(options.model);
	const input = buildInferenceShImageInput(model, options.prompt);
	const { stdout } = await runInfsh(
		["app", "run", model, "--json", "--input", JSON.stringify(input)],
		{ signal: options.signal },
	);
	const parsed = parseInfshJson(stdout);
	const reference = extractImageReference(parsed);
	if (!reference) {
		throw new Error("Inference.sh did not return an image output");
	}
	const image = await imageReferenceToBase64(reference, options.signal);
	return { ...image, model };
}
