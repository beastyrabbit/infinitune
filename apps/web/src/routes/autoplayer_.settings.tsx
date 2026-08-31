import {
	ACE_DCW_DEFAULTS,
	ACE_GENERATION_DEFAULTS,
	ACE_QUALITY_DEFAULT_MODEL,
	ACE_VAE_DEFAULT,
	normalizeAceDcwScaler,
	normalizeAceGuidanceScale,
	normalizeAceModel,
	normalizeAceSamplerMode,
	normalizeAceShift,
	normalizeAceVaeCheckpoint,
	normalizeAceVelocityEmaFactor,
	normalizeAceVelocityNormThreshold,
	parseBooleanSetting,
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
import { DEFAULT_INFERENCE_SH_IMAGE_MODEL } from "@infinitune/shared/inference-sh-image-models";
import {
	DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	DEFAULT_OPENROUTER_TEXT_MODEL,
	DEFAULT_TEXT_PROVIDER,
	normalizeLlmProvider,
} from "@infinitune/shared/text-llm-profile";
import type { LlmProvider } from "@infinitune/shared/types";
import { createFileRoute } from "@tanstack/react-router";
import {
	Disc3,
	Loader2,
	Music2,
	Network,
	Save,
	SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { OpsPageHeader } from "@/components/autoplayer/OpsPageHeader";
import { Stat } from "@/components/autoplayer/Stat";
import { SettingsTabAudioEngine } from "@/components/autoplayer/settings/SettingsTabAudioEngine";
import type {
	InferenceShImageModelOption,
	ModelOption,
} from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabModels } from "@/components/autoplayer/settings/SettingsTabModels";
import { SettingsTabNetwork } from "@/components/autoplayer/settings/SettingsTabNetwork";
import type { TestStatus } from "@/components/autoplayer/settings/TestButton";
import { Button } from "@/components/ui/button";
import { api, getRequestErrorMessage } from "@/integrations/api/client";
import {
	useAutoplayerAceModels,
	useAutoplayerCodexModelsQuery,
	useAutoplayerInferenceShImageModelsQuery,
	useAutoplayerOpenRouterModelsQuery,
	useForceGenerateRadioAlbum,
	useRadioQueue,
	useSetSetting,
	useSettings,
} from "@/integrations/api/hooks";
import { API_URL } from "@/lib/endpoints";

export const Route = createFileRoute("/autoplayer_/settings")({
	component: SettingsPage,
});

type Tab = "inventory" | "models" | "audio" | "network";

const TABS: { id: Tab; label: string; icon: typeof Disc3 }[] = [
	{ id: "inventory", label: "Inventory", icon: Disc3 },
	{ id: "models", label: "Models", icon: SlidersHorizontal },
	{ id: "audio", label: "ACE Audio", icon: Music2 },
	{ id: "network", label: "Network", icon: Network },
];

const DEFAULT_SETTINGS: Record<string, string> = {
	ollamaUrl: "http://192.168.10.120:11434",
	aceStepUrl: "http://192.168.10.242:8001",
	textProvider: DEFAULT_TEXT_PROVIDER,
	textModel: DEFAULT_OPENAI_CODEX_TEXT_MODEL,
	imageProvider: "inference-sh",
	imageModel: DEFAULT_INFERENCE_SH_IMAGE_MODEL,
	coversEnabled: "true",
	aceModel: ACE_QUALITY_DEFAULT_MODEL,
	aceVaeCheckpoint: ACE_VAE_DEFAULT,
	aceInferenceSteps: String(ACE_GENERATION_DEFAULTS.inferenceSteps),
	aceLmTemperature: String(ACE_GENERATION_DEFAULTS.lmTemperature),
	aceLmCfgScale: String(ACE_GENERATION_DEFAULTS.lmCfgScale),
	aceInferMethod: ACE_GENERATION_DEFAULTS.inferMethod,
	aceGuidanceScale: String(ACE_GENERATION_DEFAULTS.guidanceScale),
	aceSamplerMode: ACE_GENERATION_DEFAULTS.samplerMode,
	aceShift: String(ACE_GENERATION_DEFAULTS.shift),
	aceVelocityNormThreshold: String(
		ACE_GENERATION_DEFAULTS.velocityNormThreshold,
	),
	aceVelocityEmaFactor: String(ACE_GENERATION_DEFAULTS.velocityEmaFactor),
	aceUseAdg: String(ACE_GENERATION_DEFAULTS.useAdg),
	aceQueueDepth: "12",
	aceDcwEnabled: String(ACE_DCW_DEFAULTS.enabled),
	aceDcwMode: ACE_DCW_DEFAULTS.mode,
	aceDcwScaler: String(ACE_DCW_DEFAULTS.scaler),
	aceDcwHighScaler: String(ACE_DCW_DEFAULTS.highScaler),
	aceDcwWavelet: ACE_DCW_DEFAULTS.wavelet,
	aceThinking: String(ACE_GENERATION_DEFAULTS.thinking),
	aceAutoDuration: "false",
	personaProvider: DEFAULT_TEXT_PROVIDER,
	personaModel: "",
};

interface CodexAuthSession {
	id: string;
	state: string;
	verificationUrl?: string;
	userCode?: string;
	message?: string;
	error?: string;
}

interface OpenRouterAuthStatus {
	configured: boolean;
	source: "stored" | "environment" | "runtime" | "fallback" | null;
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

function normalizeDcwScalerInput(value: string, fallback: number): string {
	return String(normalizeAceDcwScaler(value, fallback));
}

function SettingsPage() {
	const settings = useSettings();
	const queue = useRadioQueue();
	const forceGenerate = useForceGenerateRadioAlbum();
	const setSetting = useSetSetting();
	const [activeTab, setActiveTab] = useState<Tab>("inventory");
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [forcing, setForcing] = useState(false);
	const [forceMessage, setForceMessage] = useState<string | null>(null);
	const [codexAuthSession, setCodexAuthSession] =
		useState<CodexAuthSession | null>(null);

	const aceModels = useAutoplayerAceModels() ?? [];
	const imageProvider = readSetting("imageProvider");
	const needsInferenceSh = imageProvider === "inference-sh";
	const inferenceShImageModelsQuery =
		useAutoplayerInferenceShImageModelsQuery(needsInferenceSh);
	const inferenceShImageModels: InferenceShImageModelOption[] = needsInferenceSh
		? (inferenceShImageModelsQuery.data ?? [])
		: [];
	const inferenceShLoading =
		needsInferenceSh && inferenceShImageModelsQuery.isFetching;
	const textProvider = normalizeProviderSetting(readSetting("textProvider"));
	const personaProvider = normalizeProviderSetting(
		readSetting("personaProvider"),
		textProvider,
	);
	const needsCodex =
		textProvider === "openai-codex" || personaProvider === "openai-codex";
	const codexModelsQuery = useAutoplayerCodexModelsQuery(needsCodex);
	const { refetch: refetchCodexModels } = codexModelsQuery;
	const codexModels: ModelOption[] = codexModelsQuery.data ?? [];
	const codexLoading = needsCodex && codexModelsQuery.isFetching;
	const needsOpenRouter =
		textProvider === "openrouter" || personaProvider === "openrouter";
	const openrouterModelsQuery =
		useAutoplayerOpenRouterModelsQuery(needsOpenRouter);
	const openrouterModels: ModelOption[] = openrouterModelsQuery.data ?? [];
	const openrouterLoading = needsOpenRouter && openrouterModelsQuery.isFetching;

	const [ollamaTest, setOllamaTest] = useState<TestStatus>({ state: "idle" });
	const [inferenceShTest, setInferenceShTest] = useState<TestStatus>({
		state: "idle",
	});
	const [codexImagegenTest, setCodexImagegenTest] = useState<TestStatus>({
		state: "idle",
	});
	const [aceTest, setAceTest] = useState<TestStatus>({ state: "idle" });
	const [codexTest, setCodexTest] = useState<TestStatus>({ state: "idle" });
	const [openrouterTest, setOpenrouterTest] = useState<TestStatus>({
		state: "idle",
	});
	const [openrouterAuth, setOpenrouterAuth] = useState<OpenRouterAuthStatus>({
		configured: false,
		source: null,
	});

	function readSetting(key: string): string {
		if (Object.hasOwn(draft, key)) return draft[key];
		return settings?.[key] ?? DEFAULT_SETTINGS[key] ?? "";
	}

	function writeSetting(key: string, value: string) {
		setDraft((current) => ({ ...current, [key]: value }));
	}

	const agentReasoning = Object.fromEntries(
		INFINITUNE_AGENT_IDS.map((agentId) => [
			agentId,
			normalizeAgentReasoningLevel(
				readSetting(getAgentReasoningSettingKey(agentId)),
				DEFAULT_AGENT_REASONING_LEVELS[agentId],
			),
		]),
	) as Record<InfinituneAgentId, AgentReasoningLevel>;

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
				if (needsCodex) void refetchCodexModels();
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
	}, [needsCodex, refetchCodexModels]);

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
			setCodexTest(
				data.session?.state === "authenticated"
					? { state: "ok", message: "Authenticated with ChatGPT" }
					: { state: "idle" },
			);
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
				{ method: "POST", body: formData },
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
				setCodexTest({ state: "ok", message: "Authenticated with ChatGPT" });
				if (needsCodex) void refetchCodexModels();
			} else {
				await refreshCodexAuthStatus();
			}
		},
		[needsCodex, refetchCodexModels, refreshCodexAuthStatus],
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

	const refreshOpenRouterAuthStatus = useCallback(async () => {
		try {
			setOpenrouterAuth(
				await api.get<OpenRouterAuthStatus>("/api/autoplayer/openrouter-auth"),
			);
		} catch {
			// Keep the last known status when the server is temporarily unavailable.
		}
	}, []);

	useEffect(() => {
		void refreshOpenRouterAuthStatus();
	}, [refreshOpenRouterAuthStatus]);

	const saveOpenRouterApiKey = useCallback(async (apiKey: string) => {
		const data = await api.post<OpenRouterAuthStatus>(
			"/api/autoplayer/openrouter-auth",
			{ apiKey },
		);
		setOpenrouterAuth(data);
		setOpenrouterTest({ state: "idle" });
	}, []);

	const clearOpenRouterApiKey = useCallback(async () => {
		const data = await api.del<OpenRouterAuthStatus>(
			"/api/autoplayer/openrouter-auth",
		);
		setOpenrouterAuth(data);
		setOpenrouterTest({ state: "idle" });
	}, []);

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
							: provider === "openrouter"
								? setOpenrouterTest
								: setAceTest;

		setStatus({ state: "testing" });
		try {
			const data = await api.post<
				{ ok: true; message: string } | { ok: false; error: string }
			>("/api/autoplayer/test-connection", { provider });
			if (data.ok) setStatus({ state: "ok", message: data.message });
			else setStatus({ state: "error", message: data.error });
		} catch (error) {
			setStatus({ state: "error", message: getRequestErrorMessage(error) });
		}
	}, []);

	async function handleForceGenerate() {
		setForcing(true);
		setForceMessage(null);
		try {
			const result = await forceGenerate(undefined);
			const message =
				result.repairedTracks > 0 && result.created > 0
					? `Repaired ${result.repairedTracks} missing track rows and created ${result.created} album job.`
					: result.repairedTracks > 0
						? `Repaired ${result.repairedTracks} missing track rows across ${result.repairedAlbums} album job(s).`
						: result.created > 0
							? `Created ${result.created} album job. ${result.stats.untouchedActiveAlbums} untouched albums now tracked.`
							: result.skipped === "manual-extra-already-queued"
								? "Manual extra album is already queued."
								: "No album job was created.";
			setForceMessage(message);
			if (result.created > 0) toast.success(message);
			else toast.info(message);
		} finally {
			setForcing(false);
		}
	}

	async function save() {
		setSaving(true);
		try {
			const normalizedAceModel = normalizeAceModel(readSetting("aceModel"));
			const payload: Record<string, string> = {
				ollamaUrl: readSetting("ollamaUrl"),
				aceStepUrl: readSetting("aceStepUrl"),
				textProvider,
				textModel:
					readSetting("textModel") ||
					(textProvider === "openrouter"
						? DEFAULT_OPENROUTER_TEXT_MODEL
						: DEFAULT_OPENAI_CODEX_TEXT_MODEL),
				imageProvider,
				imageModel: readSetting("imageModel"),
				coversEnabled: String(
					parseBooleanSetting(readSetting("coversEnabled"), true),
				),
				personaProvider,
				personaModel: normalizeFallbackModel(readSetting("personaModel")),
				aceModel: normalizedAceModel,
				aceVaeCheckpoint: normalizeAceVaeCheckpoint(
					readSetting("aceVaeCheckpoint"),
				),
				aceInferenceSteps:
					readSetting("aceInferenceSteps") ||
					String(ACE_GENERATION_DEFAULTS.inferenceSteps),
				aceLmTemperature:
					readSetting("aceLmTemperature") ||
					String(ACE_GENERATION_DEFAULTS.lmTemperature),
				aceLmCfgScale:
					readSetting("aceLmCfgScale") ||
					String(ACE_GENERATION_DEFAULTS.lmCfgScale),
				aceInferMethod:
					readSetting("aceInferMethod") || ACE_GENERATION_DEFAULTS.inferMethod,
				aceGuidanceScale: String(
					normalizeAceGuidanceScale(readSetting("aceGuidanceScale")),
				),
				aceSamplerMode: normalizeAceSamplerMode(readSetting("aceSamplerMode")),
				aceShift: String(normalizeAceShift(readSetting("aceShift"))),
				aceVelocityNormThreshold: String(
					normalizeAceVelocityNormThreshold(
						readSetting("aceVelocityNormThreshold"),
					),
				),
				aceVelocityEmaFactor: String(
					normalizeAceVelocityEmaFactor(readSetting("aceVelocityEmaFactor")),
				),
				aceUseAdg: String(
					parseBooleanSetting(
						readSetting("aceUseAdg"),
						ACE_GENERATION_DEFAULTS.useAdg,
					),
				),
				aceQueueDepth: readSetting("aceQueueDepth") || "12",
				aceDcwEnabled: String(
					parseBooleanSetting(
						readSetting("aceDcwEnabled"),
						ACE_DCW_DEFAULTS.enabled,
					),
				),
				aceDcwMode: readSetting("aceDcwMode") || ACE_DCW_DEFAULTS.mode,
				aceDcwScaler: normalizeDcwScalerInput(
					readSetting("aceDcwScaler"),
					ACE_DCW_DEFAULTS.scaler,
				),
				aceDcwHighScaler: normalizeDcwScalerInput(
					readSetting("aceDcwHighScaler"),
					ACE_DCW_DEFAULTS.highScaler,
				),
				aceDcwWavelet:
					readSetting("aceDcwWavelet").trim() || ACE_DCW_DEFAULTS.wavelet,
				aceThinking: String(
					parseBooleanSetting(
						readSetting("aceThinking"),
						ACE_GENERATION_DEFAULTS.thinking,
					),
				),
				aceAutoDuration: "false",
			};
			for (const agentId of INFINITUNE_AGENT_IDS) {
				payload[getAgentReasoningSettingKey(agentId)] = agentReasoning[agentId];
			}
			await Promise.all(
				Object.entries(payload).map(([key, value]) =>
					setSetting({ key, value }),
				),
			);
			setDraft({});
			toast.success("Radio settings saved");
		} finally {
			setSaving(false);
		}
	}

	const dirtyCount = Object.keys(draft).length;

	return (
		<div className="min-h-screen bg-[#101213] font-mono text-stone-100">
			<OpsPageHeader
				icon={SlidersHorizontal}
				title="Radio Settings"
				subtitle="Inventory, models, ACE-Step, covers, and service endpoints"
				maxWidthClass="max-w-6xl"
				right={
					dirtyCount > 0 ? (
						<div className="flex items-center gap-2 border border-amber-300/40 bg-amber-300/10 px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
							<span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
							{dirtyCount} unsaved
						</div>
					) : undefined
				}
			/>

			<main className="mx-auto max-w-6xl px-4 py-6 pb-28">
				<nav className="mb-6 grid gap-2 md:grid-cols-4">
					{TABS.map((tab, index) => {
						const Icon = tab.icon;
						const active = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={`group relative flex h-12 items-center gap-3 border px-4 font-mono text-xs font-black uppercase tracking-[0.18em] transition-colors ${
									active
										? "border-amber-300/60 bg-amber-300 text-black"
										: "border-white/15 bg-black/25 text-white/55 hover:bg-white/10 hover:text-white"
								}`}
							>
								<span
									className={`text-[10px] tabular-nums ${
										active ? "text-black/45" : "text-white/25"
									}`}
								>
									{String(index + 1).padStart(2, "0")}
								</span>
								<Icon className="h-4 w-4" />
								{tab.label}
							</button>
						);
					})}
				</nav>

				{activeTab === "inventory" ? (
					<div className="space-y-6">
						<section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
							<Stat label="Target" value={queue?.stats.inventoryTarget ?? 10} />
							<Stat
								label="Ready albums"
								value={queue?.stats.untouchedReadyAlbums ?? 0}
								tone="ready"
							/>
							<Stat
								label="Generating"
								value={queue?.stats.untouchedGeneratingAlbums ?? 0}
								tone="active"
							/>
							<Stat
								label="Incomplete"
								value={queue?.stats.incompleteAlbums ?? 0}
								tone={
									(queue?.stats.incompleteAlbums ?? 0) > 0 ? "warn" : "default"
								}
							/>
							<Stat
								label="Missing tracks"
								value={queue?.stats.missingAlbumTracks ?? 0}
								tone={
									(queue?.stats.missingAlbumTracks ?? 0) > 0
										? "warn"
										: "default"
								}
							/>
							<Stat
								label="Audio active"
								value={queue?.stats.activeAudioTracks ?? 0}
								tone="active"
							/>
							<Stat label="Duration" value="3:00" />
						</section>

						<section className="border border-white/10 bg-[#171a1b] p-5">
							<div className="mb-4 flex items-center gap-3">
								<Disc3 className="h-5 w-5 text-amber-300" />
								<h2 className="text-sm font-black uppercase tracking-[0.18em]">
									Album Inventory
								</h2>
							</div>
							<Button
								onClick={handleForceGenerate}
								disabled={forcing}
								className="h-10 rounded-none bg-amber-300 font-black text-black hover:bg-amber-200"
							>
								{forcing ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Disc3 className="mr-2 h-4 w-4" />
								)}
								{forcing ? "Creating album..." : "Force-generate album"}
							</Button>
							{forceMessage ? (
								<p className="mt-3 text-sm text-white/65">{forceMessage}</p>
							) : null}
							<div className="mt-4 grid grid-cols-3 gap-2 text-xs font-bold uppercase tracking-widest text-white/50">
								<div className="border border-white/10 p-2">12 tracks</div>
								<div className="border border-white/10 p-2">one cover</div>
								<div className="border border-white/10 p-2">180 sec</div>
							</div>
						</section>
					</div>
				) : null}

				{activeTab === "models" ? (
					<SettingsTabModels
						textProvider={textProvider}
						setTextProvider={(value) => {
							writeSetting("textProvider", value);
							writeSetting(
								"textModel",
								value === "openrouter"
									? DEFAULT_OPENROUTER_TEXT_MODEL
									: DEFAULT_OPENAI_CODEX_TEXT_MODEL,
							);
						}}
						textModel={readSetting("textModel")}
						setTextModel={(value) => writeSetting("textModel", value)}
						imageProvider={imageProvider}
						setImageProvider={(value) => {
							writeSetting("imageProvider", value);
							if (value === "inference-sh" && !readSetting("imageModel")) {
								writeSetting("imageModel", DEFAULT_INFERENCE_SH_IMAGE_MODEL);
							}
							if (value === "codex-imagegen") {
								writeSetting("imageModel", "");
							}
						}}
						imageModel={readSetting("imageModel")}
						setImageModel={(value) => writeSetting("imageModel", value)}
						coversEnabled={parseBooleanSetting(
							readSetting("coversEnabled"),
							true,
						)}
						setCoversEnabled={(value) =>
							writeSetting("coversEnabled", String(value))
						}
						aceModel={resolveAceModelSetting(
							readSetting("aceModel"),
							settings?.aceModel !== undefined || draft.aceModel !== undefined,
						)}
						setAceModel={(value) => writeSetting("aceModel", value)}
						aceVaeCheckpoint={normalizeAceVaeCheckpoint(
							readSetting("aceVaeCheckpoint"),
						)}
						setAceVaeCheckpoint={(value) =>
							writeSetting("aceVaeCheckpoint", value)
						}
						personaModel={readSetting("personaModel")}
						setPersonaModel={(value) => writeSetting("personaModel", value)}
						personaProvider={personaProvider}
						setPersonaProvider={(value) => {
							writeSetting("personaProvider", value);
							writeSetting("personaModel", "");
						}}
						agentReasoning={agentReasoning}
						setAgentReasoningLevel={(agentId, level) =>
							writeSetting(getAgentReasoningSettingKey(agentId), level)
						}
						aceModels={aceModels}
						inferenceShImageModels={inferenceShImageModels}
						inferenceShLoading={inferenceShLoading}
						codexModels={codexModels}
						codexLoading={codexLoading}
						openrouterModels={openrouterModels}
						openrouterLoading={openrouterLoading}
						activePlaylist={false}
					/>
				) : null}

				{activeTab === "audio" ? (
					<SettingsTabAudioEngine
						inferSteps={readSetting("aceInferenceSteps")}
						setInferSteps={(value) => writeSetting("aceInferenceSteps", value)}
						lmTemp={readSetting("aceLmTemperature")}
						setLmTemp={(value) => writeSetting("aceLmTemperature", value)}
						lmCfg={readSetting("aceLmCfgScale")}
						setLmCfg={(value) => writeSetting("aceLmCfgScale", value)}
						inferMethod={readSetting("aceInferMethod")}
						setInferMethod={(value) => writeSetting("aceInferMethod", value)}
						guidanceScale={readSetting("aceGuidanceScale")}
						setGuidanceScale={(value) =>
							writeSetting("aceGuidanceScale", value)
						}
						samplerMode={readSetting("aceSamplerMode")}
						setSamplerMode={(value) => writeSetting("aceSamplerMode", value)}
						shift={readSetting("aceShift")}
						setShift={(value) => writeSetting("aceShift", value)}
						velocityNormThreshold={readSetting("aceVelocityNormThreshold")}
						setVelocityNormThreshold={(value) =>
							writeSetting("aceVelocityNormThreshold", value)
						}
						velocityEmaFactor={readSetting("aceVelocityEmaFactor")}
						setVelocityEmaFactor={(value) =>
							writeSetting("aceVelocityEmaFactor", value)
						}
						aceUseAdg={parseBooleanSetting(
							readSetting("aceUseAdg"),
							ACE_GENERATION_DEFAULTS.useAdg,
						)}
						setAceUseAdg={(value) => writeSetting("aceUseAdg", String(value))}
						aceThinking={parseBooleanSetting(
							readSetting("aceThinking"),
							ACE_GENERATION_DEFAULTS.thinking,
						)}
						setAceThinking={(value) =>
							writeSetting("aceThinking", String(value))
						}
						aceAutoDuration={false}
						setAceAutoDuration={() => writeSetting("aceAutoDuration", "false")}
						aceQueueDepth={readSetting("aceQueueDepth")}
						setAceQueueDepth={(value) => writeSetting("aceQueueDepth", value)}
						aceDcwEnabled={parseBooleanSetting(
							readSetting("aceDcwEnabled"),
							ACE_DCW_DEFAULTS.enabled,
						)}
						setAceDcwEnabled={(value) =>
							writeSetting("aceDcwEnabled", String(value))
						}
						aceDcwMode={readSetting("aceDcwMode")}
						setAceDcwMode={(value) => writeSetting("aceDcwMode", value)}
						aceDcwScaler={readSetting("aceDcwScaler")}
						setAceDcwScaler={(value) => writeSetting("aceDcwScaler", value)}
						aceDcwHighScaler={readSetting("aceDcwHighScaler")}
						setAceDcwHighScaler={(value) =>
							writeSetting("aceDcwHighScaler", value)
						}
						aceDcwWavelet={readSetting("aceDcwWavelet")}
						setAceDcwWavelet={(value) => writeSetting("aceDcwWavelet", value)}
						activePlaylist={false}
					/>
				) : null}

				{activeTab === "network" ? (
					<SettingsTabNetwork
						ollamaUrl={readSetting("ollamaUrl")}
						setOllamaUrl={(value) => writeSetting("ollamaUrl", value)}
						aceStepUrl={readSetting("aceStepUrl")}
						setAceStepUrl={(value) => writeSetting("aceStepUrl", value)}
						imageProvider={imageProvider}
						ollamaTest={ollamaTest}
						aceTest={aceTest}
						inferenceShTest={inferenceShTest}
						codexImagegenTest={codexImagegenTest}
						codexTest={codexTest}
						openrouterTest={openrouterTest}
						openrouterAuth={openrouterAuth}
						codexAuthSession={codexAuthSession}
						onStartCodexAuth={startCodexAuth}
						onUploadCodexAuthFile={uploadCodexAuthCache}
						onCancelCodexAuth={cancelCodexAuth}
						onSaveOpenRouterApiKey={saveOpenRouterApiKey}
						onClearOpenRouterApiKey={clearOpenRouterApiKey}
						onTest={testConnection}
					/>
				) : null}
			</main>

			{/* Sticky save bar — always reachable, reflects unsaved draft state */}
			<div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-black/90 backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
					<span className="hidden font-mono text-[10px] font-black uppercase tracking-[0.2em] text-white/35 sm:block">
						{dirtyCount > 0
							? `${dirtyCount} setting${dirtyCount === 1 ? "" : "s"} modified`
							: "All changes saved"}
					</span>
					<Button
						className={`h-12 flex-1 rounded-none border-4 font-mono text-sm font-black uppercase transition-colors ${
							dirtyCount > 0
								? "border-amber-300/50 bg-amber-300 text-black hover:bg-white hover:text-black"
								: "border-white/20 bg-red-500 text-white hover:bg-white hover:text-black"
						}`}
						onClick={save}
						disabled={saving}
					>
						{saving ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						{saving ? "Saving..." : "Save radio settings"}
					</Button>
				</div>
			</div>
		</div>
	);
}
