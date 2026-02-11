import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/autoplayer_/test/connections")({
	component: ConnectionsTestPage,
});

type ServiceStatus = "idle" | "testing" | "ok" | "error";

interface ServiceState {
	status: ServiceStatus;
	message: string | null;
	responseTime: number | null;
	models: string[] | null;
}

const INITIAL_STATE: ServiceState = {
	status: "idle",
	message: null,
	responseTime: null,
	models: null,
};

const SERVICES = ["ollama", "comfyui", "ace-step", "openrouter"] as const;
type ServiceName = (typeof SERVICES)[number];

const SERVICE_META: Record<ServiceName, { label: string; urlKey: string }> = {
	ollama: { label: "OLLAMA", urlKey: "ollamaUrl" },
	comfyui: { label: "COMFYUI", urlKey: "comfyuiUrl" },
	"ace-step": { label: "ACE-STEP", urlKey: "aceStepUrl" },
	openrouter: { label: "OPENROUTER", urlKey: "" },
};

function ConnectionsTestPage() {
	const settings = useQuery(api.settings.getAll);

	const [states, setStates] = useState<Record<ServiceName, ServiceState>>({
		ollama: { ...INITIAL_STATE },
		comfyui: { ...INITIAL_STATE },
		"ace-step": { ...INITIAL_STATE },
		openrouter: { ...INITIAL_STATE },
	});

	const testService = useCallback(
		async (service: ServiceName) => {
			setStates((prev) => ({
				...prev,
				[service]: {
					status: "testing",
					message: null,
					responseTime: null,
					models: null,
				},
			}));

			const startedAt = Date.now();

			try {
				const body: Record<string, string> = { provider: service };
				if (service === "openrouter" && settings?.openrouterApiKey) {
					body.apiKey = settings.openrouterApiKey;
				}

				const res = await fetch("/api/autoplayer/test-connection", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});

				const data = await res.json();
				const responseTime = Date.now() - startedAt;

				if (data.ok) {
					// Fetch models for services that support it
					let models: string[] | null = null;
					if (service === "ollama") {
						try {
							const modelsRes = await fetch("/api/autoplayer/ollama-models");
							const modelsData = await modelsRes.json();
							models = (modelsData.models || []).map(
								(m: unknown) => (m as { name: string }).name,
							);
						} catch {}
					} else if (service === "ace-step") {
						try {
							const modelsRes = await fetch("/api/autoplayer/ace-models");
							const modelsData = await modelsRes.json();
							models = (modelsData.models || []).map(
								(m: unknown) => (m as { name: string }).name,
							);
						} catch {}
					}

					setStates((prev) => ({
						...prev,
						[service]: {
							status: "ok",
							message: data.message,
							responseTime,
							models,
						},
					}));
				} else {
					setStates((prev) => ({
						...prev,
						[service]: {
							status: "error",
							message: data.error,
							responseTime,
							models: null,
						},
					}));
				}
			} catch (e: unknown) {
				setStates((prev) => ({
					...prev,
					[service]: {
						status: "error",
						message: e instanceof Error ? e.message : String(e),
						responseTime: Date.now() - startedAt,
						models: null,
					},
				}));
			}
		},
		[settings],
	);

	const testAll = useCallback(() => {
		for (const service of SERVICES) {
			testService(service);
		}
	}, [testService]);

	const getUrl = (service: ServiceName): string => {
		if (service === "openrouter") return "openrouter.ai";
		const key = SERVICE_META[service].urlKey;
		return settings?.[key] || "...";
	};

	return (
		<div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
			{/* TEST ALL */}
			<button
				type="button"
				className="w-full h-10 border-4 border-white/20 bg-green-600 font-mono text-xs font-black uppercase text-white hover:bg-green-500 transition-colors"
				onClick={testAll}
			>
				[TEST ALL]
			</button>

			{/* SERVICE CARDS */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{SERVICES.map((service) => {
					const state = states[service];
					const meta = SERVICE_META[service];
					const url = getUrl(service);

					return (
						<div
							key={service}
							className={`border-4 bg-black ${
								state.status === "error"
									? "border-red-500/40"
									: state.status === "ok"
										? "border-green-600/30"
										: state.status === "testing"
											? "border-yellow-500/40"
											: "border-white/10"
							}`}
						>
							<div className="px-4 py-2 flex items-center justify-between border-b-2 border-white/10">
								<span className="text-xs font-black uppercase tracking-widest">
									{meta.label}
								</span>
								<StatusPill status={state.status} />
							</div>

							<div className="p-4 space-y-3">
								<div className="text-[10px] font-mono text-white/30 truncate">
									{url}
								</div>

								{service === "openrouter" && !settings?.openrouterApiKey && (
									<p className="text-[10px] font-bold uppercase text-yellow-500">
										No API key set in settings
									</p>
								)}

								{state.responseTime !== null && (
									<div className="text-[10px] font-bold uppercase text-white/30">
										Response:{" "}
										<span className="text-white/60">
											{state.responseTime}ms
										</span>
									</div>
								)}

								{state.message && (
									<p
										className={`text-[10px] font-bold uppercase ${state.status === "error" ? "text-red-400" : "text-green-400"}`}
									>
										{state.message}
									</p>
								)}

								{state.models && state.models.length > 0 && (
									<div>
										<span className="text-[10px] font-black uppercase text-white/40 block mb-1">
											MODELS ({state.models.length})
										</span>
										<div className="flex flex-wrap gap-1">
											{state.models.map((m) => (
												<span
													key={m}
													className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 border border-white/10 text-white/50"
												>
													{m}
												</span>
											))}
										</div>
									</div>
								)}

								<button
									type="button"
									className={`w-full h-8 border-4 font-mono text-[10px] font-black uppercase transition-colors ${
										state.status === "testing"
											? "border-white/10 bg-white/5 text-white/20 cursor-not-allowed"
											: "border-white/20 bg-gray-900 text-white/60 hover:text-white"
									}`}
									onClick={() => testService(service)}
									disabled={state.status === "testing"}
								>
									{state.status === "testing" ? (
										<span className="flex items-center justify-center gap-1">
											<Loader2 className="h-3 w-3 animate-spin" />
											TESTING...
										</span>
									) : (
										"[TEST]"
									)}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function StatusPill({ status }: { status: ServiceStatus }) {
	const styles: Record<ServiceStatus, string> = {
		idle: "bg-white/10 text-white/40",
		testing: "bg-yellow-500 text-black animate-pulse",
		ok: "bg-green-600 text-white",
		error: "bg-red-600 text-white",
	};
	return (
		<span
			className={`px-2 py-0.5 text-[10px] font-black uppercase ${styles[status]}`}
		>
			{status}
		</span>
	);
}
