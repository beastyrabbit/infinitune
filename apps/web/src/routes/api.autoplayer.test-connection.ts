import { createFileRoute } from "@tanstack/react-router";
import { API_URL } from "@/lib/endpoints";
import { getServiceUrls } from "@/lib/server-settings";

export const Route = createFileRoute("/api/autoplayer/test-connection")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				try {
					const body = await request.json();
					const { provider, apiKey } = body as {
						provider: string;
						apiKey?: string;
					};
					const urls = await getServiceUrls();

					if (provider === "ollama") {
						const ollamaUrl = urls.ollamaUrl;
						const response = await fetch(`${ollamaUrl}/api/tags`, {
							signal: AbortSignal.timeout(5000),
						});
						if (!response.ok) {
							return new Response(
								JSON.stringify({
									ok: false,
									error: `Ollama returned ${response.status}`,
								}),
								{ headers: { "Content-Type": "application/json" } },
							);
						}
						const data = await response.json();
						const count = data.models?.length ?? 0;
						return new Response(
							JSON.stringify({
								ok: true,
								message: `Connected — ${count} models available`,
							}),
							{ headers: { "Content-Type": "application/json" } },
						);
					}

					if (provider === "openrouter") {
						if (!apiKey) {
							return new Response(
								JSON.stringify({ ok: false, error: "No API key provided" }),
								{ headers: { "Content-Type": "application/json" } },
							);
						}
						const response = await fetch(
							"https://openrouter.ai/api/v1/models",
							{
								headers: { Authorization: `Bearer ${apiKey}` },
								signal: AbortSignal.timeout(5000),
							},
						);
						if (!response.ok) {
							return new Response(
								JSON.stringify({
									ok: false,
									error: `OpenRouter returned ${response.status}`,
								}),
								{ headers: { "Content-Type": "application/json" } },
							);
						}
						return new Response(
							JSON.stringify({ ok: true, message: "Connected to OpenRouter" }),
							{ headers: { "Content-Type": "application/json" } },
						);
					}

					if (provider === "openai-codex") {
						const response = await fetch(
							`${API_URL}/api/autoplayer/test-connection`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ provider: "openai-codex" }),
								signal: AbortSignal.timeout(5000),
							},
						);
						const data = await response.json();
						return new Response(JSON.stringify(data), {
							status: response.status,
							headers: { "Content-Type": "application/json" },
						});
					}

					if (provider === "comfyui") {
						const comfyuiUrl = urls.comfyuiUrl;
						const response = await fetch(`${comfyuiUrl}/system_stats`, {
							signal: AbortSignal.timeout(5000),
						});
						if (!response.ok) {
							return new Response(
								JSON.stringify({
									ok: false,
									error: `ComfyUI returned ${response.status}`,
								}),
								{ headers: { "Content-Type": "application/json" } },
							);
						}
						return new Response(
							JSON.stringify({ ok: true, message: "Connected to ComfyUI" }),
							{ headers: { "Content-Type": "application/json" } },
						);
					}

					if (provider === "ace-step") {
						const aceUrl = urls.aceStepUrl;
						const response = await fetch(`${aceUrl}/v1/models`, {
							signal: AbortSignal.timeout(5000),
						});
						if (!response.ok) {
							return new Response(
								JSON.stringify({
									ok: false,
									error: `ACE-Step returned ${response.status}`,
								}),
								{ headers: { "Content-Type": "application/json" } },
							);
						}
						const data = await response.json();
						const models = data.data || [];
						return new Response(
							JSON.stringify({
								ok: true,
								message: `Connected — ${models.length} model(s)`,
							}),
							{ headers: { "Content-Type": "application/json" } },
						);
					}

					return new Response(
						JSON.stringify({
							ok: false,
							error: `Unknown provider: ${provider}`,
						}),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					);
				} catch (error: unknown) {
					const message =
						error instanceof Error && error.name === "TimeoutError"
							? "Connection timed out"
							: error instanceof Error
								? error.message
								: "Connection failed";
					return new Response(JSON.stringify({ ok: false, error: message }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}
			},
		},
	},
});
