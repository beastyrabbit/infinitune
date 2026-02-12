import WebSocket from "ws";
import COMFYUI_WORKFLOW from "@/data/comfyui-workflow-z-image-turbo.json";
import { getServiceUrls, getSetting } from "@/lib/server-settings";

interface WorkflowNode {
	class_type: string;
	inputs: Record<string, unknown>;
	_meta?: { title?: string };
}

export interface CoverResult {
	imageBase64: string;
	format: string;
}

function asSingleLinePreview(text: string, max = 280): string {
	return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractBase64FromImageUrl(url: string): string | null {
	if (!url) return null;
	if (url.startsWith("data:image/")) {
		const comma = url.indexOf(",");
		return comma >= 0 ? url.slice(comma + 1) : null;
	}
	// Some APIs may return raw base64 without a data URL prefix.
	if (/^[A-Za-z0-9+/=\r\n]+$/.test(url) && url.length > 100) {
		return url.replace(/\s+/g, "");
	}
	return null;
}

export async function generateCover(options: {
	coverPrompt: string;
	provider: string;
	model?: string;
	signal?: AbortSignal;
}): Promise<CoverResult | null> {
	const { coverPrompt, provider, model, signal } = options;

	// Always frame the prompt as circular CD disc artwork
	const fullPrompt = `Circular CD disc artwork, printed directly on a compact disc surface. ${coverPrompt}`;

	if (provider === "comfyui" || provider === "ollama") {
		const urls = await getServiceUrls();
		const comfyuiUrl = urls.comfyuiUrl;

		const workflow = JSON.parse(JSON.stringify(COMFYUI_WORKFLOW));

		let promptNodeId: string | null = null;
		let samplerNodeId: string | null = null;
		let firstClipNode: string | null = null;
		for (const [id, node] of Object.entries(workflow) as [
			string,
			WorkflowNode,
		][]) {
			if (node.class_type === "CLIPTextEncode") {
				const title = (node._meta?.title || "").toLowerCase();
				if (title.includes("positive") || title.includes("prompt")) {
					promptNodeId = id;
				}
				if (!firstClipNode && !title.includes("negative")) {
					firstClipNode = id;
				}
			}
			if (node.class_type === "KSampler") {
				samplerNodeId = id;
			}
		}
		if (!promptNodeId && firstClipNode) promptNodeId = firstClipNode;
		if (promptNodeId) workflow[promptNodeId].inputs.text = fullPrompt;
		if (samplerNodeId)
			workflow[samplerNodeId].inputs.seed = Math.floor(
				Math.random() * Number.MAX_SAFE_INTEGER,
			);

		const WS_SAVE_NODES = ["SaveImageWebsocket", "Websocket_Image_Save"];
		let hasWsSaveNode = false;
		for (const [_id, node] of Object.entries(workflow) as [
			string,
			WorkflowNode,
		][]) {
			if (WS_SAVE_NODES.includes(node.class_type)) {
				hasWsSaveNode = true;
			}
		}
		if (!hasWsSaveNode) {
			for (const [id, node] of Object.entries(workflow) as [
				string,
				WorkflowNode,
			][]) {
				if (
					node.class_type === "SaveImage" ||
					node.class_type === "PreviewImage"
				) {
					workflow[id] = {
						inputs: { images: node.inputs.images },
						class_type: "SaveImageWebsocket",
						_meta: { title: "SaveImageWebsocket" },
					};
					break;
				}
			}
		}

		const clientId = crypto.randomUUID();
		const wsUrl = comfyuiUrl.replace(/^http/, "ws");

		const base64 = await new Promise<string>((resolve, reject) => {
			const ws = new WebSocket(`${wsUrl}/ws?clientId=${clientId}`);
			let imageBuffer: Buffer | null = null;
			let resolved = false;

			const cleanup = () => {
				if (!resolved) {
					resolved = true;
					ws.close();
					reject(new Error("Cover generation aborted"));
				}
			};
			signal?.addEventListener("abort", cleanup);

			const timeout = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					ws.close();
					reject(new Error("ComfyUI WebSocket timed out (3 min)"));
				}
			}, 180_000);

			ws.on("open", async () => {
				try {
					const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ prompt: workflow, client_id: clientId }),
						signal,
					});
					if (!submitRes.ok) {
						const errText = await submitRes.text();
						throw new Error(`ComfyUI submit failed: ${errText}`);
					}
				} catch (err) {
					if (!resolved) {
						resolved = true;
						clearTimeout(timeout);
						ws.close();
						reject(err);
					}
				}
			});

			ws.on("message", (data: Buffer | string) => {
				if (resolved) return;
				const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
				try {
					const msg = JSON.parse(raw.toString());
					if (msg.type === "executed" || msg.type === "execution_success") {
						if (imageBuffer) {
							resolved = true;
							clearTimeout(timeout);
							ws.close();
							resolve(imageBuffer.toString("base64"));
						}
					} else if (msg.type === "execution_error") {
						resolved = true;
						clearTimeout(timeout);
						ws.close();
						reject(new Error("ComfyUI generation failed"));
					}
					return;
				} catch {
					// Not JSON — treat as binary image data
				}
				if (raw.length > 8) {
					imageBuffer = raw.subarray(8);
				}
			});

			ws.on("error", (err) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					reject(new Error(`ComfyUI WebSocket error: ${err.message}`));
				}
			});

			ws.on("close", () => {
				if (!resolved) {
					if (imageBuffer) {
						resolved = true;
						clearTimeout(timeout);
						resolve(imageBuffer.toString("base64"));
					} else {
						resolved = true;
						clearTimeout(timeout);
						reject(new Error("ComfyUI WebSocket closed without image"));
					}
				}
			});
		});

		return { imageBase64: base64, format: "png" };
	}

	if (provider === "openrouter") {
		if (!model?.trim()) {
			throw new Error("OpenRouter image model is required");
		}

		const openrouterKey =
			(await getSetting("openrouterApiKey")) ||
			process.env.OPENROUTER_API_KEY ||
			"";
		if (!openrouterKey) {
			throw new Error("OpenRouter API key not configured");
		}
		const requestBase = {
			model,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: fullPrompt }],
				},
			],
			stream: false,
		};

		// Some models require both modalities, others image-only.
		const attempts = [
			{ ...requestBase, modalities: ["image", "text"] },
			{ ...requestBase, modalities: ["image"] },
		];

		let lastError = "Unknown OpenRouter image error";
		for (const body of attempts) {
			const response = await fetch(
				"https://openrouter.ai/api/v1/chat/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${openrouterKey}`,
					},
					body: JSON.stringify(body),
					signal,
				},
			);

			const contentType = response.headers.get("content-type") || "";
			if (!response.ok) {
				const err = await response.text();
				lastError = `HTTP ${response.status} (${contentType || "unknown content-type"}): ${asSingleLinePreview(err)}`;
				continue;
			}

			if (!contentType.toLowerCase().includes("application/json")) {
				const raw = await response.text();
				lastError = `Non-JSON response (${contentType || "unknown"}): ${asSingleLinePreview(raw)}`;
				continue;
			}

			const data = await response.json();
			const imageUrl =
				data?.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
				data?.choices?.[0]?.message?.images?.[0]?.imageUrl?.url ||
				data?.output?.find?.(
					(item: { type?: string }) => item.type === "image_generation_call",
				)?.result;

			const b64 =
				typeof imageUrl === "string"
					? extractBase64FromImageUrl(imageUrl)
					: null;
			if (b64) {
				return { imageBase64: b64, format: "png" };
			}

			lastError = `No image payload found in OpenRouter response.`;
		}

		throw new Error(`OpenRouter image generation failed: ${lastError}`);
	}

	return null;
}
