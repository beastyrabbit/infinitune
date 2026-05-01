import {
	ACE_DCW_DEFAULTS,
	ACE_VAE_DEFAULT,
	normalizeAceDcwScaler,
	normalizeAceModel,
	normalizeAceVaeCheckpoint,
	resolveAceModelSetting,
} from "@infinitune/shared/ace-settings";
import {
	type AgentReasoningLevel,
	DEFAULT_AGENT_REASONING_LEVELS,
	getAgentReasoningSettingKey,
	INFINITUNE_AGENT_IDS,
	type InfinituneAgentId,
	normalizeAgentReasoningLevel,
} from "@infinitune/shared/agent-reasoning";
import { DEFAULT_INFERENCE_SH_IMAGE_MODEL as DEFAULT_IMAGE_MODEL } from "@infinitune/shared/inference-sh-image-models";
import {
	DEFAULT_ANTHROPIC_TEXT_MODEL,
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	DEFAULT_TEXT_PROVIDER,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Cpu, Music, Plug, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsTabAudioEngine } from "@/components/autoplayer/settings/SettingsTabAudioEngine";
import type {
	InferenceShImageModelOption,
	ModelOption,
} from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabModels } from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabNetwork } from "@/components/autoplayer/settings/SettingsTabNetwork";
import type { TestStatus } from "@/components/autoplayer/settings/TestButton";
import { Button } from "@/components/ui/button";
import { usePlaylistHeartbeat } from "@/hooks/usePlaylistHeartbeat";
import {
	useAutoplayerAceModels,
	useAutoplayerCodexModelsQuery,
	useAutoplayerInferenceShImageModelsQuery,
	usePlaylistByKey,
	useSetSetting,
	useSettings,
	useUpdatePlaylistParams,
} from "@/integrations/api/hooks";
import { API_URL } from "@/lib/endpoints";
import { validatePlaylistKeySearch } from "@/lib/playlist-key";

export const Route = createFileRoute("/autoplayer_/settings")({
	component: SettingsPage,
	validateSearch: validatePlaylistKeySearch,
});

type Tab = "network" | "models" | "audio";

const TABS: { id: Tab; label: string; icon: typeof Plug }[] = [
	{ id: "network", label: "NETWORK", icon: Plug },
	{ id: "models", label: "MODELS", icon: Cpu },
	{ id: "audio", label: "AUDIO ENGINE", icon: Music },
];

interface CodexAuthSession {
	id: string;
	state: string;
	verificationUrl?: string;
	userCode?: string;
	message?: string;
	error?: string;
}

function normalizeFallbackModel(value: string | undefined | null): string {
	return value === "__fallback__" ? "" : (value ?? "");
}

function normalizeProviderSetting(
	value: string | undefined | null,
	fallback: LlmProvider = DEFAULT_TEXT_PROVIDER,
): LlmProvider {
	return normalizeLlmProvider(value, fallback);
}

function parseBooleanSetting(
	value: string | undefined | null,
	fallback: boolean,
): boolean {
	return value ? value !== "false" : fallback;
}

function normalizeDcwScalerInput(value: string, fallback: number): string {
	return String(normalizeAceDcwScaler(value, fallback));
}

function SettingsPage() {
	const navigate = useNavigate();
	const { pl } = Route.useSearch();
	const settings = useSettings();
	const setSetting = useSetSetting();
	const activePlaylist = usePlaylistByKey(pl ?? null);
	usePlaylistHeartbeat(activePlaylist?.id ?? null);
	const updateParams = useUpdatePlaylistParams();

	// Tab state
	const [activeTab, setActiveTab] = useState<Tab>("network");

	// Generation params
	const [inferSteps, setInferSteps] = useState("8");
	const [lmTemp, setLmTemp] = useState("0.85");
	const [lmCfg, setLmCfg] = useState("2.5");
	const [inferMethod, setInferMethod] = useState("ode");
	const [aceThinking, setAceThinking] = useState(false);
	const [aceAutoDuration, setAceAutoDuration] = useState(true);
	const [aceDcwEnabled, setAceDcwEnabled] = useState<boolean>(
		ACE_DCW_DEFAULTS.enabled,
	);
	const [aceDcwMode, setAceDcwMode] = useState<string>(ACE_DCW_DEFAULTS.mode);
	const [aceDcwScaler, setAceDcwScaler] = useState(
		String(ACE_DCW_DEFAULTS.scaler),
	);
	const [aceDcwHighScaler, setAceDcwHighScaler] = useState(
		String(ACE_DCW_DEFAULTS.highScaler),
	);
	const [aceDcwWavelet, setAceDcwWavelet] = useState<string>(
		ACE_DCW_DEFAULTS.wavelet,
	);
	const [aceVaeCheckpoint, setAceVaeCheckpoint] = useState(ACE_VAE_DEFAULT);

	// Service URLs
	const [ollamaUrl, setOllamaUrl] = useState("http://192.168.10.120:11434");
	const [aceStepUrl, setAceStepUrl] = useState("http://192.168.10.120:8001");
	const [comfyuiUrl, setComfyuiUrl] = useState("http://192.168.10.120:8188");

	// Model settings
	const [textProvider, setTextProvider] = useState<LlmProvider>(
		DEFAULT_TEXT_PROVIDER,
	);
	const [textModel, setTextModel] = useState(DEFAULT_OPENAI_CODEX_TEXT_MODEL);
	const [imageProvider, setImageProvider] = useState("comfyui");
	const [imageModel, setImageModel] = useState("");
	const [aceModel, setAceModel] = useState("");
	const [personaProvider, setPersonaProvider] = useState<LlmProvider>(
		DEFAULT_TEXT_PROVIDER,
	);
	const [personaModel, setPersonaModel] = useState("");
	const [agentReasoning, setAgentReasoning] = useState<
		Record<InfinituneAgentId, AgentReasoningLevel>
	>(DEFAULT_AGENT_REASONING_LEVELS);

	// Available models
	const aceModels = useAutoplayerAceModels() ?? [];
	const needsInferenceSh = imageProvider === "inference-sh";
	const inferenceShImageModelsQuery =
		useAutoplayerInferenceShImageModelsQuery(needsInferenceSh);
	const inferenceShImageModels: InferenceShImageModelOption[] = needsInferenceSh
		? (inferenceShImageModelsQuery.data ?? [])
		: [];
	const inferenceShLoading =
		needsInferenceSh && inferenceShImageModelsQuery.isFetching;
	const needsCodex =
		textProvider === "openai-codex" || personaProvider === "openai-codex";
	const codexModelsQuery = useAutoplayerCodexModelsQuery(needsCodex);
	const { refetch: refetchCodexModels } = codexModelsQuery;
	const codexModels: ModelOption[] = codexModelsQuery.data ?? [];
	const codexLoading = needsCodex && codexModelsQuery.isFetching;
	const [codexAuthSession, setCodexAuthSession] =
		useState<CodexAuthSession | null>(null);

	// Test statuses
	const [ollamaTest, setOllamaTest] = useState<TestStatus>({ state: "idle" });
	const [inferenceShTest, setInferenceShTest] = useState<TestStatus>({
		state: "idle",
	});
	const [codexImagegenTest, setCodexImagegenTest] = useState<TestStatus>({
		state: "idle",
	});
	const [comfyuiTest, setComfyuiTest] = useState<TestStatus>({ state: "idle" });
	const [aceTest, setAceTest] = useState<TestStatus>({ state: "idle" });
	const [codexTest, setCodexTest] = useState<TestStatus>({ state: "idle" });

	const [saved, setSaved] = useState(false);
	const [personaScanTriggered, setPersonaScanTriggered] = useState(false);

	// Load settings from Convex
	useEffect(() => {
		if (!settings) return;
		setOllamaUrl(settings.ollamaUrl || "http://192.168.10.120:11434");
		setAceStepUrl(settings.aceStepUrl || "http://192.168.10.120:8001");
		setComfyuiUrl(settings.comfyuiUrl || "http://192.168.10.120:8188");
		const normalizedTextProvider = normalizeProviderSetting(
			settings.textProvider,
			DEFAULT_TEXT_PROVIDER,
		);
		setTextProvider(normalizedTextProvider);
		const configuredTextModel = settings.textModel?.trim() || "";
		setTextModel(
			configuredTextModel ||
				(normalizedTextProvider === "anthropic"
					? DEFAULT_ANTHROPIC_TEXT_MODEL
					: DEFAULT_OPENAI_CODEX_TEXT_MODEL),
		);
		const imgProv = settings.imageProvider || "comfyui";
		const normalizedImageProvider =
			imgProv === "ollama"
				? "comfyui"
				: imgProv === "openrouter"
					? "inference-sh"
					: imgProv;
		setImageProvider(normalizedImageProvider);
		setImageModel(
			normalizedImageProvider === "inference-sh"
				? imgProv === "openrouter"
					? DEFAULT_IMAGE_MODEL
					: settings.imageModel || DEFAULT_IMAGE_MODEL
				: settings.imageModel || "",
		);
		setAceModel(
			resolveAceModelSetting(
				settings.aceModel,
				settings.aceModel !== undefined,
			),
		);
		setAceVaeCheckpoint(
			normalizeAceVaeCheckpoint(settings.aceVaeCheckpoint || ACE_VAE_DEFAULT),
		);
		setPersonaProvider(
			normalizeProviderSetting(
				settings.personaProvider,
				normalizedTextProvider,
			),
		);
		setPersonaModel(normalizeFallbackModel(settings.personaModel));
		setAgentReasoning(
			Object.fromEntries(
				INFINITUNE_AGENT_IDS.map((agentId) => [
					agentId,
					normalizeAgentReasoningLevel(
						settings[getAgentReasoningSettingKey(agentId)],
						DEFAULT_AGENT_REASONING_LEVELS[agentId],
					),
				]),
			) as Record<InfinituneAgentId, AgentReasoningLevel>,
		);
		const globalAceDcwEnabled = parseBooleanSetting(
			settings.aceDcwEnabled,
			ACE_DCW_DEFAULTS.enabled,
		);
		const globalAceDcwMode = settings.aceDcwMode || ACE_DCW_DEFAULTS.mode;
		const globalAceDcwScaler = normalizeDcwScalerInput(
			settings.aceDcwScaler || "",
			ACE_DCW_DEFAULTS.scaler,
		);
		const globalAceDcwHighScaler = normalizeDcwScalerInput(
			settings.aceDcwHighScaler || "",
			ACE_DCW_DEFAULTS.highScaler,
		);
		const globalAceDcwWavelet =
			settings.aceDcwWavelet || ACE_DCW_DEFAULTS.wavelet;

		if (activePlaylist) {
			setInferSteps(
				activePlaylist.inferenceSteps?.toString() ||
					settings.aceInferenceSteps ||
					"8",
			);
			setLmTemp(
				activePlaylist.lmTemperature?.toString() ||
					settings.aceLmTemperature ||
					"0.85",
			);
			setLmCfg(
				activePlaylist.lmCfgScale?.toString() ||
					settings.aceLmCfgScale ||
					"2.5",
			);
			setInferMethod(
				activePlaylist.inferMethod || settings.aceInferMethod || "ode",
			);
			setAceThinking(activePlaylist.aceThinking ?? false);
			setAceAutoDuration(activePlaylist.aceAutoDuration ?? true);
			setAceDcwEnabled(activePlaylist.aceDcwEnabled ?? globalAceDcwEnabled);
			setAceDcwMode(activePlaylist.aceDcwMode || globalAceDcwMode);
			setAceDcwScaler(
				activePlaylist.aceDcwScaler == null
					? globalAceDcwScaler
					: normalizeDcwScalerInput(
							activePlaylist.aceDcwScaler.toString(),
							ACE_DCW_DEFAULTS.scaler,
						),
			);
			setAceDcwHighScaler(
				activePlaylist.aceDcwHighScaler == null
					? globalAceDcwHighScaler
					: normalizeDcwScalerInput(
							activePlaylist.aceDcwHighScaler.toString(),
							ACE_DCW_DEFAULTS.highScaler,
						),
			);
			setAceDcwWavelet(activePlaylist.aceDcwWavelet || globalAceDcwWavelet);
			setAceModel(
				activePlaylist.aceModel !== null
					? activePlaylist.aceModel
					: resolveAceModelSetting(
							settings.aceModel,
							settings.aceModel !== undefined,
						),
			);
			setAceVaeCheckpoint(
				activePlaylist.aceVaeCheckpoint ||
					normalizeAceVaeCheckpoint(
						settings.aceVaeCheckpoint || ACE_VAE_DEFAULT,
					),
			);
		} else {
			setInferSteps(settings.aceInferenceSteps || "8");
			setLmTemp(settings.aceLmTemperature || "0.85");
			setLmCfg(settings.aceLmCfgScale || "2.5");
			setInferMethod(settings.aceInferMethod || "ode");
			setAceThinking(settings.aceThinking === "true");
			setAceAutoDuration(settings.aceAutoDuration !== "false");
			setAceDcwEnabled(globalAceDcwEnabled);
			setAceDcwMode(globalAceDcwMode);
			setAceDcwScaler(globalAceDcwScaler);
			setAceDcwHighScaler(globalAceDcwHighScaler);
			setAceDcwWavelet(globalAceDcwWavelet);
		}
	}, [settings, activePlaylist]);

	// Poll Codex auth status while network tab is visible.
	const refreshCodexAuthStatus = useCallback(async () => {
		try {
			const res = await fetch(`${API_URL}/api/autoplayer/codex-auth/status`);
			if (!res.ok) return;
			const data = (await res.json()) as {
				session?: CodexAuthSession | null;
				loginStatus?: { mode?: string };
			};
			setCodexAuthSession(data.session ?? null);

			if (data.session?.state === "authenticated") {
				setCodexTest({ state: "ok", message: "Authenticated with ChatGPT" });
				if (
					textProvider === "openai-codex" ||
					personaProvider === "openai-codex"
				) {
					void refetchCodexModels();
				}
			} else if (data.session?.state === "error") {
				setCodexTest({
					state: "error",
					message: data.session.error || "Authentication failed",
				});
			} else if (data.loginStatus?.mode === "chatgpt") {
				setCodexTest({ state: "ok", message: "Authenticated with ChatGPT" });
			}
		} catch {
			// Ignore polling errors.
		}
	}, [personaProvider, refetchCodexModels, textProvider]);

	useEffect(() => {
		if (activeTab !== "network") return;
		void refreshCodexAuthStatus();
		const timer = setInterval(() => {
			void refreshCodexAuthStatus();
		}, 3000);
		return () => clearInterval(timer);
	}, [activeTab, refreshCodexAuthStatus]);

	const startCodexAuth = useCallback(async () => {
		setCodexTest({ state: "testing" });
		try {
			const res = await fetch(`${API_URL}/api/autoplayer/codex-auth/start`, {
				method: "POST",
			});
			const data = (await res.json()) as {
				session?: CodexAuthSession;
				error?: string;
			};
			if (!res.ok || data.error) {
				setCodexTest({
					state: "error",
					message: data.error || "Failed to start device auth",
				});
				return;
			}

			setCodexAuthSession(data.session ?? null);
			if (data.session?.state === "authenticated") {
				setCodexTest({ state: "ok", message: "Authenticated with ChatGPT" });
			} else {
				setCodexTest({ state: "idle" });
			}
		} catch {
			setCodexTest({ state: "error", message: "Request failed" });
		}
	}, []);

	const uploadCodexAuthCache = useCallback(
		async (file: File) => {
			const formData = new FormData();
			formData.append("authFile", file, "auth.json");

			const res = await fetch(
				`${API_URL}/api/autoplayer/codex-auth/upload-cache`,
				{
					method: "POST",
					body: formData,
				},
			);
			const data = (await res.json()) as {
				session?: CodexAuthSession;
				loginStatus?: { mode?: string };
				error?: string;
			};
			if (!res.ok || data.error) {
				throw new Error(data.error || "Failed to upload auth.json");
			}

			setCodexAuthSession(data.session ?? null);
			if (data.loginStatus?.mode === "chatgpt") {
				setCodexTest({
					state: "ok",
					message: "Authenticated with ChatGPT",
				});
				if (
					textProvider === "openai-codex" ||
					personaProvider === "openai-codex"
				) {
					void refetchCodexModels();
				}
			} else {
				await refreshCodexAuthStatus();
			}
		},
		[personaProvider, refreshCodexAuthStatus, refetchCodexModels, textProvider],
	);

	const cancelCodexAuth = useCallback(async () => {
		try {
			const res = await fetch(`${API_URL}/api/autoplayer/codex-auth/cancel`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: codexAuthSession?.id }),
			});
			const data = (await res.json()) as { session?: CodexAuthSession };
			setCodexAuthSession(data.session ?? null);
			setCodexTest({ state: "idle" });
		} catch {
			// Ignore cancel errors.
		}
	}, [codexAuthSession?.id]);

	const testConnection = useCallback(async (provider: string) => {
		const setStatus =
			provider === "ollama"
				? setOllamaTest
				: provider === "inference-sh"
					? setInferenceShTest
					: provider === "codex-imagegen"
						? setCodexImagegenTest
						: provider === "openai-codex"
							? setCodexTest
							: provider === "comfyui"
								? setComfyuiTest
								: setAceTest;

		setStatus({ state: "testing" });
		try {
			const res = await fetch(`${API_URL}/api/autoplayer/test-connection`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider }),
			});
			const data = await res.json();
			if (data.ok) {
				setStatus({ state: "ok", message: data.message });
			} else {
				setStatus({ state: "error", message: data.error });
			}
		} catch {
			setStatus({ state: "error", message: "Request failed" });
		}
	}, []);

	const save = async () => {
		const normalizedDcwScaler = normalizeDcwScalerInput(
			aceDcwScaler,
			ACE_DCW_DEFAULTS.scaler,
		);
		const normalizedDcwHighScaler = normalizeDcwScalerInput(
			aceDcwHighScaler,
			ACE_DCW_DEFAULTS.highScaler,
		);
		const normalizedAceModel = normalizeAceModel(aceModel);
		const inheritedAceModel = normalizeAceModel(
			resolveAceModelSetting(
				settings?.aceModel,
				settings?.aceModel !== undefined,
			),
		);
		const playlistAceModel =
			activePlaylist &&
			(!normalizedAceModel ||
				(activePlaylist.aceModel == null &&
					normalizedAceModel === inheritedAceModel))
				? null
				: normalizedAceModel;
		const promises: Promise<unknown>[] = [
			setSetting({ key: "ollamaUrl", value: ollamaUrl }),
			setSetting({ key: "aceStepUrl", value: aceStepUrl }),
			setSetting({ key: "comfyuiUrl", value: comfyuiUrl }),
			setSetting({ key: "textProvider", value: textProvider }),
			setSetting({ key: "textModel", value: textModel }),
			setSetting({ key: "imageProvider", value: imageProvider }),
			setSetting({ key: "imageModel", value: imageModel }),
			setSetting({ key: "aceModel", value: normalizedAceModel }),
			setSetting({ key: "personaProvider", value: personaProvider }),
			setSetting({
				key: "personaModel",
				value: normalizeFallbackModel(personaModel),
			}),
			setSetting({ key: "aceInferenceSteps", value: inferSteps }),
			setSetting({ key: "aceLmTemperature", value: lmTemp }),
			setSetting({ key: "aceLmCfgScale", value: lmCfg }),
			setSetting({ key: "aceInferMethod", value: inferMethod }),
			setSetting({ key: "aceDcwEnabled", value: String(aceDcwEnabled) }),
			setSetting({ key: "aceDcwMode", value: aceDcwMode }),
			setSetting({ key: "aceDcwScaler", value: normalizedDcwScaler }),
			setSetting({ key: "aceDcwHighScaler", value: normalizedDcwHighScaler }),
			setSetting({ key: "aceDcwWavelet", value: aceDcwWavelet }),
			setSetting({
				key: "aceVaeCheckpoint",
				value: normalizeAceVaeCheckpoint(aceVaeCheckpoint),
			}),
			setSetting({ key: "aceThinking", value: String(aceThinking) }),
			setSetting({ key: "aceAutoDuration", value: String(aceAutoDuration) }),
			...INFINITUNE_AGENT_IDS.map((agentId) =>
				setSetting({
					key: getAgentReasoningSettingKey(agentId),
					value: agentReasoning[agentId],
				}),
			),
		];

		if (activePlaylist) {
			promises.push(
				updateParams({
					id: activePlaylist.id,
					inferenceSteps: inferSteps
						? Number.parseInt(inferSteps, 10)
						: undefined,
					lmTemperature: lmTemp ? Number.parseFloat(lmTemp) : undefined,
					lmCfgScale: lmCfg ? Number.parseFloat(lmCfg) : undefined,
					inferMethod: inferMethod || undefined,
					aceModel: playlistAceModel,
					aceDcwEnabled,
					aceDcwMode,
					aceDcwScaler: Number.parseFloat(normalizedDcwScaler),
					aceDcwHighScaler: Number.parseFloat(normalizedDcwHighScaler),
					aceDcwWavelet: aceDcwWavelet || undefined,
					aceVaeCheckpoint: normalizeAceVaeCheckpoint(aceVaeCheckpoint),
					aceThinking,
					aceAutoDuration,
				}),
			);
		}

		await Promise.all(promises);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	return (
		<div className="font-mono min-h-screen bg-gray-950 text-white">
			{/* HEADER */}
			<header className="border-b-4 border-white/20 bg-black">
				<div className="flex items-center justify-between px-4 py-3">
					<h1 className="text-3xl font-black tracking-tighter uppercase sm:text-5xl">
						SETTINGS
					</h1>
					<button
						type="button"
						className="font-mono text-sm font-bold uppercase text-white/60 hover:text-red-500"
						onClick={() =>
							navigate({ to: "/autoplayer", search: (prev) => prev })
						}
					>
						[BACK]
					</button>
				</div>
			</header>

			<div className="max-w-5xl mx-auto px-4 py-8">
				{/* Mobile: horizontal tab strip */}
				<div className="flex gap-0 md:hidden mb-6">
					{TABS.map((tab, i) => {
						const Icon = tab.icon;
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								className={`flex-1 h-10 border-4 border-white/20 font-mono text-[10px] font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 ${
									i > 0 ? "border-l-0" : ""
								} ${
									isActive
										? "bg-white text-black"
										: "bg-transparent text-white/60 hover:bg-white/10"
								}`}
								onClick={() => setActiveTab(tab.id)}
							>
								<Icon size={12} />
								{tab.label}
								{tab.id === "audio" && activePlaylist && (
									<span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
								)}
							</button>
						);
					})}
				</div>

				{/* Desktop: sidebar + panel grid */}
				<div className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
					{/* Desktop sidebar — hidden on mobile */}
					<nav className="hidden md:flex md:flex-col gap-1">
						{TABS.map((tab) => {
							const Icon = tab.icon;
							const isActive = activeTab === tab.id;
							return (
								<button
									key={tab.id}
									type="button"
									className={`w-full h-10 px-3 border-4 border-white/20 font-mono text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-2 ${
										isActive
											? "bg-white text-black"
											: "bg-transparent text-white/60 hover:bg-white/10 hover:text-white"
									}`}
									onClick={() => setActiveTab(tab.id)}
								>
									<Icon size={14} />
									{tab.label}
									{tab.id === "audio" && activePlaylist && (
										<span className="ml-auto w-2 h-2 rounded-full bg-yellow-500" />
									)}
								</button>
							);
						})}
					</nav>

					{/* Content panel */}
					<div className="min-w-0">
						{activeTab === "network" && (
							<SettingsTabNetwork
								ollamaUrl={ollamaUrl}
								setOllamaUrl={setOllamaUrl}
								aceStepUrl={aceStepUrl}
								setAceStepUrl={setAceStepUrl}
								comfyuiUrl={comfyuiUrl}
								setComfyuiUrl={setComfyuiUrl}
								imageProvider={imageProvider}
								ollamaTest={ollamaTest}
								aceTest={aceTest}
								comfyuiTest={comfyuiTest}
								inferenceShTest={inferenceShTest}
								codexImagegenTest={codexImagegenTest}
								codexTest={codexTest}
								codexAuthSession={codexAuthSession}
								onStartCodexAuth={startCodexAuth}
								onUploadCodexAuthFile={uploadCodexAuthCache}
								onCancelCodexAuth={cancelCodexAuth}
								onTest={testConnection}
							/>
						)}

						{activeTab === "models" && (
							<SettingsTabModels
								textProvider={textProvider}
								setTextProvider={(v) =>
									setTextProvider(
										normalizeProviderSetting(v, DEFAULT_TEXT_PROVIDER),
									)
								}
								textModel={textModel}
								setTextModel={setTextModel}
								imageProvider={imageProvider}
								setImageProvider={(v) => {
									setImageProvider(v);
									if (v === "inference-sh" && !imageModel) {
										setImageModel(DEFAULT_IMAGE_MODEL);
									}
									if (v === "codex-imagegen") {
										setImageModel("");
									}
								}}
								imageModel={imageModel}
								setImageModel={setImageModel}
								aceModel={aceModel}
								setAceModel={setAceModel}
								aceVaeCheckpoint={aceVaeCheckpoint}
								setAceVaeCheckpoint={setAceVaeCheckpoint}
								personaProvider={personaProvider}
								setPersonaProvider={(v) =>
									setPersonaProvider(normalizeProviderSetting(v, textProvider))
								}
								personaModel={personaModel}
								setPersonaModel={setPersonaModel}
								agentReasoning={agentReasoning}
								setAgentReasoningLevel={(agentId, level) =>
									setAgentReasoning((current) => ({
										...current,
										[agentId]: level,
									}))
								}
								aceModels={aceModels}
								inferenceShImageModels={inferenceShImageModels}
								inferenceShLoading={inferenceShLoading}
								codexModels={codexModels}
								codexLoading={codexLoading}
							/>
						)}

						{activeTab === "audio" && (
							<SettingsTabAudioEngine
								inferSteps={inferSteps}
								setInferSteps={setInferSteps}
								lmTemp={lmTemp}
								setLmTemp={setLmTemp}
								lmCfg={lmCfg}
								setLmCfg={setLmCfg}
								inferMethod={inferMethod}
								setInferMethod={setInferMethod}
								aceThinking={aceThinking}
								setAceThinking={setAceThinking}
								aceAutoDuration={aceAutoDuration}
								setAceAutoDuration={setAceAutoDuration}
								aceDcwEnabled={aceDcwEnabled}
								setAceDcwEnabled={setAceDcwEnabled}
								aceDcwMode={aceDcwMode}
								setAceDcwMode={setAceDcwMode}
								aceDcwScaler={aceDcwScaler}
								setAceDcwScaler={setAceDcwScaler}
								aceDcwHighScaler={aceDcwHighScaler}
								setAceDcwHighScaler={setAceDcwHighScaler}
								aceDcwWavelet={aceDcwWavelet}
								setAceDcwWavelet={setAceDcwWavelet}
								activePlaylist={!!activePlaylist}
							/>
						)}

						{/* PERSONA SCAN — visible on models tab */}
						{activeTab === "models" && (
							<div className="mt-6">
								<Button
									className={`w-full h-10 rounded-none border-2 font-mono text-xs font-black uppercase transition-colors ${
										personaScanTriggered
											? "border-pink-500/40 bg-pink-500/20 text-pink-300"
											: "border-pink-500/40 bg-transparent text-pink-400 hover:bg-pink-500/20"
									}`}
									disabled={personaScanTriggered}
									onClick={async () => {
										const workerUrl = API_URL;
										try {
											const response = await fetch(
												`${workerUrl}/api/worker/persona/trigger`,
												{
													method: "POST",
												},
											);
											if (!response.ok) {
												throw new Error(
													`Persona scan failed: ${response.status}`,
												);
											}
											setPersonaScanTriggered(true);
											setTimeout(() => setPersonaScanTriggered(false), 3000);
										} catch {
											// Worker may be unreachable
										}
									}}
								>
									<ScanSearch className="h-3.5 w-3.5 mr-1.5" />
									{personaScanTriggered
										? "PERSONA SCAN TRIGGERED"
										: "RUN PERSONA SCAN"}
								</Button>
							</div>
						)}

						{/* SAVE — always visible below content */}
						<div className="mt-8">
							<Button
								className={`w-full h-12 rounded-none border-4 font-mono text-sm font-black uppercase transition-colors ${
									saved
										? "border-green-500/40 bg-green-500 text-white"
										: "border-white/20 bg-red-500 text-white hover:bg-white hover:text-black"
								}`}
								onClick={save}
							>
								{saved ? "SAVED" : "SAVE SETTINGS"}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
