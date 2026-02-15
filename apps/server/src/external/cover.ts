import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { callImageGen } from "./llm-client";
import { getServiceUrls } from "./service-urls";

interface WorkflowNode {
	class_type: string;
	inputs: Record<string, unknown>;
	_meta?: { title?: string };
}

export interface CoverResult {
	imageBase64: string;
	format: string;
}

function loadComfyuiWorkflow(): Record<string, WorkflowNode> {
	const workflowPath = path.resolve(
		import.meta.dirname,
		"./comfyui-workflow.json",
	);
	return JSON.parse(fs.readFileSync(workflowPath, "utf-8"));
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

		const workflow = JSON.parse(
			JSON.stringify(loadComfyuiWorkflow()),
		) as Record<string, WorkflowNode>;

		let promptNodeId: string | null = null;
		let samplerNodeId: string | null = null;
		let firstClipNode: string | null = null;
		for (const [id, node] of Object.entries(workflow)) {
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
		for (const [_id, node] of Object.entries(workflow)) {
			if (WS_SAVE_NODES.includes(node.class_type)) {
				hasWsSaveNode = true;
			}
		}
		if (!hasWsSaveNode) {
			for (const [id, node] of Object.entries(workflow)) {
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
						body: JSON.stringify({
							prompt: workflow,
							client_id: clientId,
						}),
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

		const result = await callImageGen({
			model,
			prompt: fullPrompt,
			signal,
		});
		return { imageBase64: result.base64, format: "png" };
	}

	return null;
}
