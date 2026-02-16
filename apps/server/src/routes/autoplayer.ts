import { Hono } from "hono";
import { getServiceUrls, getSetting } from "../external/service-urls";
import { logger } from "../logger";

interface OllamaModel {
	name: string;
	size?: number;
	modified_at?: string;
	details?: { families?: string[] };
}

interface OpenRouterModel {
	id: string;
	name: string;
	pricing: { prompt: string; completion: string };
	context_length: number;
	architecture?: { modality?: string };
	output_modalities?: string[];
}

const app = new Hono();

// ─── Legacy audio URL redirect ──────────────────────────────────────
app.get("/audio/:id", (c) => {
	return c.redirect(`/api/songs/${c.req.param("id")}/audio`, 301);
});

// ─── GET /ollama-models ─────────────────────────────────────────────
app.get("/ollama-models", async (c) => {
	try {
		const urls = await getServiceUrls();
		const response = await fetch(`${urls.ollamaUrl}/api/tags`, {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			return c.json(
				{ error: `Ollama returned ${response.status}`, models: [] },
				502,
			);
		}
		const data = (await response.json()) as { models?: OllamaModel[] };

		const models = (data.models || []).map((m: OllamaModel) => {
			const families: string[] = m.details?.families || [];
			const nameLower = m.name.toLowerCase();
			const isVision =
				families.some(
					(f: string) => f.includes("clip") || f.toLowerCase().includes("vl"),
				) ||
				nameLower.includes("vl") ||
				nameLower.includes("llava") ||
				nameLower.includes("vision");
			const isEmbedding =
				families.some((f: string) => f.includes("bert")) ||
				nameLower.includes("embed");
			const isOcr = nameLower.includes("ocr");

			let type = "text";
			if (isEmbedding) type = "embedding";
			else if (isVision || isOcr) type = "vision";

			return {
				name: m.name,
				size: m.size,
				modifiedAt: m.modified_at,
				vision: isVision || isOcr,
				type,
			};
		});

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch Ollama models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch Ollama models",
				models: [],
			},
			500,
		);
	}
});

// ─── GET /ace-models ────────────────────────────────────────────────
app.get("/ace-models", async (c) => {
	try {
		const urls = await getServiceUrls();
		const response = await fetch(`${urls.aceStepUrl}/v1/models`, {
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok) {
			return c.json(
				{ error: `ACE-Step returned ${response.status}`, models: [] },
				502,
			);
		}
		const data = (await response.json()) as {
			data?: { id?: string; name?: string }[];
			models?: { id?: string; name?: string }[];
		};

		const rawModels = data.data || data.models || [];
		const models = rawModels.map((m: { id?: string; name?: string }) => ({
			name: m.id || m.name,
			is_default: rawModels.length === 1,
		}));

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch ACE-Step models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch ACE-Step models",
				models: [],
			},
			500,
		);
	}
});

// ─── GET /openrouter-models?type=text|image ─────────────────────────
app.get("/openrouter-models", async (c) => {
	try {
		const type = c.req.query("type") || "text";

		const apiKey = await getSetting("openrouterApiKey");
		if (!apiKey) {
			return c.json(
				{ error: "No OpenRouter API key configured", models: [] },
				400,
			);
		}

		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return c.json(
				{ error: `OpenRouter returned ${response.status}`, models: [] },
				502,
			);
		}

		const data = (await response.json()) as { data?: OpenRouterModel[] };
		const allModels: OpenRouterModel[] = data.data || [];

		let filtered: typeof allModels;
		if (type === "image") {
			filtered = allModels.filter(
				(m) =>
					m.output_modalities?.includes("image") ||
					m.architecture?.modality === "text->image",
			);
		} else {
			filtered = allModels.filter(
				(m) =>
					m.architecture?.modality === "text->text" ||
					m.architecture?.modality === "text+image->text",
			);
		}

		const models = filtered.map((m) => ({
			id: m.id,
			name: m.name,
			promptPrice: m.pricing.prompt,
			completionPrice: m.pricing.completion,
			contextLength: m.context_length,
		}));

		return c.json({ models });
	} catch (error: unknown) {
		logger.warn({ err: error }, "Failed to fetch OpenRouter models");
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to fetch OpenRouter models",
				models: [],
			},
			500,
		);
	}
});

// ─── POST /test-connection ──────────────────────────────────────────
app.post("/test-connection", async (c) => {
	try {
		const body = await c.req.json<{ provider: string; apiKey?: string }>();
		const { provider, apiKey } = body;
		const urls = await getServiceUrls();

		if (provider === "ollama") {
			const response = await fetch(`${urls.ollamaUrl}/api/tags`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "ollama", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `Ollama returned ${response.status}`,
				});
			}
			const data = (await response.json()) as { models?: unknown[] };
			const count = data.models?.length ?? 0;
			return c.json({
				ok: true,
				message: `Connected — ${count} models available`,
			});
		}

		if (provider === "openrouter") {
			if (!apiKey) {
				return c.json({ ok: false, error: "No API key provided" });
			}
			const response = await fetch("https://openrouter.ai/api/v1/models", {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "openrouter", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `OpenRouter returned ${response.status}`,
				});
			}
			return c.json({ ok: true, message: "Connected to OpenRouter" });
		}

		if (provider === "comfyui") {
			const response = await fetch(`${urls.comfyuiUrl}/system_stats`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "comfyui", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `ComfyUI returned ${response.status}`,
				});
			}
			return c.json({ ok: true, message: "Connected to ComfyUI" });
		}

		if (provider === "ace-step") {
			const response = await fetch(`${urls.aceStepUrl}/v1/models`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) {
				logger.warn(
					{ provider: "ace-step", status: response.status },
					"Connection test failed",
				);
				return c.json({
					ok: false,
					error: `ACE-Step returned ${response.status}`,
				});
			}
			const data = (await response.json()) as { data?: unknown[] };
			const models = data.data || [];
			return c.json({
				ok: true,
				message: `Connected — ${models.length} model(s)`,
			});
		}

		return c.json({ ok: false, error: `Unknown provider: ${provider}` }, 400);
	} catch (error: unknown) {
		const message =
			error instanceof Error && error.name === "TimeoutError"
				? "Connection timed out"
				: error instanceof Error
					? error.message
					: "Connection failed";
		return c.json({ ok: false, error: message }, 500);
	}
});

export default app;
