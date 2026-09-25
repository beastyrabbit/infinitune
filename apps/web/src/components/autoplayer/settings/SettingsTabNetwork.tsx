import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SettingsField, SettingsPanel } from "./SettingsPanel";
import { TestButton, type TestStatus } from "./TestButton";

export interface NetworkTabProps {
	ollamaUrl: string;
	setOllamaUrl: (v: string) => void;
	aceStepUrl: string;
	setAceStepUrl: (v: string) => void;
	aceStepUrlManagedByEnvironment: boolean;
	imageProvider: string;
	ollamaTest: TestStatus;
	aceTest: TestStatus;
	inferenceShTest: TestStatus;
	codexImagegenTest: TestStatus;
	codexTest: TestStatus;
	openrouterTest: TestStatus;
	openrouterAuth: {
		configured: boolean;
		source: "stored" | "environment" | "runtime" | "fallback" | null;
		canManage: boolean;
		setupAllowed: boolean;
		claimRequired: boolean;
		managedExternally: boolean;
	};
	codexAuthSession: {
		id: string;
		state: string;
		verificationUrl?: string;
		userCode?: string;
		message?: string;
		error?: string;
	} | null;
	onUploadCodexAuthFile: (file: File) => Promise<void>;
	onStartCodexAuth: () => void;
	onCancelCodexAuth: () => void;
	onSaveOpenRouterApiKey: (apiKey: string) => Promise<void>;
	onClearOpenRouterApiKey: () => Promise<void>;
	onTest: (provider: string) => void;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0";
const DEVICE_AUTH_VERIFICATION_URL_REGEX =
	/^https?:\/\/auth\.openai\.com\/codex\/device/i;

type KeyStatusState = "idle" | "saving" | "success" | "error";
type AuthUploadState = "idle" | "uploading" | "success" | "error";

export type OpenRouterCredentialUiMode =
	| "owner"
	| "setup"
	| "claim"
	| "external"
	| "shared";

export function getOpenRouterCredentialUiMode(
	status: NetworkTabProps["openrouterAuth"],
): OpenRouterCredentialUiMode {
	if (status.managedExternally) return "external";
	if (status.canManage) return "owner";
	if (status.claimRequired) return "claim";
	if (status.setupAllowed) return "setup";
	return "shared";
}

function getOpenRouterKeyStatusClass(state: KeyStatusState): string {
	if (state === "error") return "bg-red-950/40 text-red-300";
	if (state === "success") return "bg-green-950/40 text-green-300";
	return "bg-yellow-950/40 text-yellow-300";
}

function getAuthUploadStatusClass(state: AuthUploadState): string {
	if (state === "success") return "text-green-300 bg-green-950/40";
	if (state === "error") return "text-red-300 bg-red-950/40";
	return "text-yellow-300 bg-yellow-950/40";
}

function getApiKeyFieldLabel(
	mode: OpenRouterCredentialUiMode,
	configured: boolean,
): string {
	if (mode === "claim") return "Current API Key";
	return configured ? "Replace API Key" : "Add API Key";
}

function OpenRouterCredentialControls({
	mode,
	configured,
	source,
	apiKey,
	onApiKeyChange,
	saving,
	onSave,
	onClear,
}: Readonly<{
	mode: OpenRouterCredentialUiMode;
	configured: boolean;
	source: NetworkTabProps["openrouterAuth"]["source"];
	apiKey: string;
	onApiKeyChange: (apiKey: string) => void;
	saving: boolean;
	onSave: () => Promise<void>;
	onClear: () => Promise<void>;
}>) {
	if (mode !== "owner" && mode !== "setup" && mode !== "claim") {
		return (
			<div className="px-3 py-2 border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-white/55">
				{mode === "external"
					? "MANAGED OUTSIDE INFINITUNE. UPDATE THE SERVER ENVIRONMENT TO CHANGE THIS CREDENTIAL."
					: "SHARED SERVER CREDENTIAL. ONLY ITS OWNER CAN REPLACE OR REMOVE IT."}
			</div>
		);
	}
	return (
		<>
			<SettingsField label={getApiKeyFieldLabel(mode, configured)}>
				<Input
					type="password"
					autoComplete="new-password"
					className={inputClass}
					placeholder={
						mode === "claim"
							? "PASTE THE CURRENT OPENROUTER KEY"
							: "PASTE A NEW OPENROUTER KEY"
					}
					value={apiKey}
					onChange={(event) => onApiKeyChange(event.target.value)}
				/>
				<p className="mt-1 text-[10px] font-bold uppercase text-white/40">
					{mode === "claim"
						? "ENTER THE EXISTING KEY ONCE TO CLAIM MANAGEMENT WITHOUT REPLACING IT."
						: "THE BROWSER CANNOT READ A SAVED KEY. THE SERVER STORES IT IN PI AUTH."}
				</p>
			</SettingsField>

			<div className="flex gap-2">
				<button
					type="button"
					className="flex-1 h-10 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white hover:bg-white/10 disabled:opacity-30"
					onClick={() => void onSave()}
					disabled={!apiKey.trim() || saving}
				>
					{mode === "claim" ? "CLAIM MANAGEMENT" : "SAVE KEY"}
				</button>
				{mode === "owner" && source === "stored" && (
					<button
						type="button"
						className="h-10 px-4 border-4 border-red-500/30 bg-transparent font-mono text-xs font-black uppercase text-red-300 hover:bg-red-950/40 disabled:opacity-30"
						onClick={() => void onClear()}
						disabled={saving}
					>
						REMOVE STORED KEY
					</button>
				)}
			</div>
		</>
	);
}

export function SettingsTabNetwork({
	ollamaUrl,
	setOllamaUrl,
	aceStepUrl,
	setAceStepUrl,
	aceStepUrlManagedByEnvironment,
	imageProvider,
	ollamaTest,
	aceTest,
	inferenceShTest,
	codexImagegenTest,
	codexTest,
	openrouterTest,
	openrouterAuth,
	codexAuthSession,
	onUploadCodexAuthFile,
	onStartCodexAuth,
	onCancelCodexAuth,
	onSaveOpenRouterApiKey,
	onClearOpenRouterApiKey,
	onTest,
}: NetworkTabProps) {
	const [openrouterApiKey, setOpenrouterApiKey] = useState("");
	const openrouterCredentialMode =
		getOpenRouterCredentialUiMode(openrouterAuth);
	const [openrouterKeyStatus, setOpenrouterKeyStatus] = useState<{
		state: KeyStatusState;
		message?: string;
	}>({ state: "idle" });
	const saveOpenRouterKey = async () => {
		if (!openrouterApiKey.trim()) return;
		setOpenrouterKeyStatus({ state: "saving", message: "Saving key..." });
		try {
			await onSaveOpenRouterApiKey(openrouterApiKey);
			setOpenrouterApiKey("");
			setOpenrouterKeyStatus({
				state: "success",
				message:
					openrouterCredentialMode === "claim"
						? "OpenRouter credential management claimed."
						: "OpenRouter key saved.",
			});
		} catch (error) {
			setOpenrouterKeyStatus({
				state: "error",
				message: error instanceof Error ? error.message : "Could not save key",
			});
		}
	};
	const clearOpenRouterKey = async () => {
		if (!window.confirm("Remove the stored OpenRouter API key?")) return;
		setOpenrouterKeyStatus({ state: "saving", message: "Removing key..." });
		try {
			await onClearOpenRouterApiKey();
			setOpenrouterKeyStatus({
				state: "success",
				message: "Stored OpenRouter key removed.",
			});
		} catch (error) {
			setOpenrouterKeyStatus({
				state: "error",
				message:
					error instanceof Error ? error.message : "Could not remove key",
			});
		}
	};
	const codexStatusText = codexAuthSession
		? codexAuthSession.error ||
			codexAuthSession.message ||
			codexAuthSession.state
		: "NOT AUTHENTICATED";
	const codexAwaitingBrowser =
		codexAuthSession?.state === "pending" ||
		codexAuthSession?.state === "awaiting_confirmation";
	const hasValidVerificationUrl = Boolean(
		codexAuthSession?.verificationUrl &&
			DEVICE_AUTH_VERIFICATION_URL_REGEX.test(codexAuthSession.verificationUrl),
	);
	const handleCopyCodexCode = async () => {
		if (!codexAuthSession?.userCode) return;
		try {
			await navigator.clipboard.writeText(codexAuthSession.userCode);
		} catch {
			// Ignore clipboard failures in this UI.
		}
	};
	const [authUploadStatus, setAuthUploadStatus] = useState<{
		state: AuthUploadState;
		message?: string;
	}>({ state: "idle" });
	const codexAuthInputRef = useRef<HTMLInputElement>(null);
	const handleUploadCodexAuthFile = async (file?: File) => {
		if (!file) return;
		setAuthUploadStatus({
			state: "uploading",
			message: "Uploading auth.json...",
		});
		try {
			await onUploadCodexAuthFile(file);
			setAuthUploadStatus({ state: "success", message: "AUTH.JSON uploaded." });
			setTimeout(() => {
				setAuthUploadStatus({ state: "idle" });
			}, 3500);
		} catch (error) {
			setAuthUploadStatus({
				state: "error",
				message: error instanceof Error ? error.message : "Upload failed",
			});
		}
	};

	return (
		<div className="space-y-8">
			<SettingsPanel title="SERVICE ENDPOINTS">
				<SettingsField
					label="Ollama URL"
					trailing={
						<TestButton provider="ollama" status={ollamaTest} onTest={onTest} />
					}
				>
					<Input
						className={inputClass}
						placeholder="http://192.168.10.120:11434"
						value={ollamaUrl}
						onChange={(e) => setOllamaUrl(e.target.value)}
					/>
				</SettingsField>

				<SettingsField
					label="ACE-Step URL"
					hint={
						aceStepUrlManagedByEnvironment
							? "Managed by the ACE_STEP_URL environment variable"
							: undefined
					}
					trailing={
						<TestButton provider="ace-step" status={aceTest} onTest={onTest} />
					}
				>
					<Input
						className={inputClass}
						placeholder="http://192.168.10.242:8001"
						value={aceStepUrl}
						disabled={aceStepUrlManagedByEnvironment}
						onChange={(e) => setAceStepUrl(e.target.value)}
					/>
				</SettingsField>
			</SettingsPanel>

			{imageProvider === "inference-sh" && (
				<SettingsPanel
					title="INFERENCE.SH COVER IMAGES"
					badge={
						<TestButton
							provider="inference-sh"
							status={inferenceShTest}
							onTest={onTest}
						/>
					}
				>
					<SettingsField label="Runtime">
						<div className="min-h-10 px-3 py-2 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-white/70">
							USES LOCAL INFSH CLI AUTH
						</div>
					</SettingsField>
				</SettingsPanel>
			)}

			{imageProvider === "codex-imagegen" && (
				<SettingsPanel
					title="CODEX IMAGEGEN COVER IMAGES"
					badge={
						<TestButton
							provider="codex-imagegen"
							status={codexImagegenTest}
							onTest={onTest}
						/>
					}
				>
					<SettingsField label="Runtime">
						<div className="min-h-10 px-3 py-2 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-white/70">
							USES LOCAL CODEX CLI CHATGPT LOGIN
						</div>
					</SettingsField>
				</SettingsPanel>
			)}

			<SettingsPanel
				title="OPENROUTER — SONG TEXT"
				badge={
					<TestButton
						provider="openrouter"
						status={openrouterTest}
						onTest={onTest}
					/>
				}
			>
				<SettingsField label="Authentication Status">
					<div className="min-h-10 px-3 py-2 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-white/70">
						{openrouterAuth.configured
							? `CONFIGURED VIA ${openrouterAuth.source ?? "UNKNOWN SOURCE"}`
							: "NOT CONFIGURED"}
					</div>
				</SettingsField>

				<OpenRouterCredentialControls
					mode={openrouterCredentialMode}
					configured={openrouterAuth.configured}
					source={openrouterAuth.source}
					apiKey={openrouterApiKey}
					onApiKeyChange={setOpenrouterApiKey}
					saving={openrouterKeyStatus.state === "saving"}
					onSave={saveOpenRouterKey}
					onClear={clearOpenRouterKey}
				/>
				{openrouterKeyStatus.message && (
					<div
						className={`px-3 py-2 border-4 border-white/20 font-mono text-xs font-bold uppercase ${getOpenRouterKeyStatusClass(
							openrouterKeyStatus.state,
						)}`}
					>
						{openrouterKeyStatus.message}
					</div>
				)}
			</SettingsPanel>

			<SettingsPanel
				title="OPENAI CODEX (CHATGPT SUBSCRIPTION)"
				badge={
					<TestButton
						provider="openai-codex"
						status={codexTest}
						onTest={onTest}
					/>
				}
			>
				<SettingsField label="Authentication Status">
					<div className="min-h-10 px-3 py-2 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-white/70">
						{codexStatusText}
					</div>
				</SettingsField>

				{codexAuthSession?.userCode && (
					<SettingsField label="One-Time Code">
						<div className="flex gap-2">
							<div className="h-10 flex-1 px-3 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-black leading-[30px] uppercase text-yellow-300 tracking-widest">
								{codexAuthSession.userCode}
							</div>
							<button
								type="button"
								className="h-10 px-3 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white/80 hover:bg-white/10"
								onClick={handleCopyCodexCode}
							>
								COPY
							</button>
						</div>
					</SettingsField>
				)}

				{hasValidVerificationUrl && codexAuthSession?.verificationUrl && (
					<SettingsField label="Verification URL">
						<a
							href={codexAuthSession.verificationUrl}
							target="_blank"
							rel="noreferrer"
							className="block h-10 px-3 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold leading-[30px] uppercase text-yellow-400 hover:text-yellow-300"
						>
							OPEN AUTH PAGE
						</a>
					</SettingsField>
				)}

				<SettingsField label="Device Auth Fallback">
					<div className="mb-2 text-[10px] font-bold uppercase text-white/40">
						If the device flow is blocked, copy{" "}
						<span className="text-yellow-300">~/.codex/auth.json</span> from a
						machine where you logged in, then upload it here.
					</div>
					<div className="grid gap-2">
						<input
							ref={codexAuthInputRef}
							type="file"
							accept=".json,application/json"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								void handleUploadCodexAuthFile(file);
								e.currentTarget.value = "";
							}}
						/>
						<div className="flex gap-2">
							<button
								type="button"
								className="h-10 px-3 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white/80 hover:bg-white/10 disabled:opacity-30"
								onClick={() => codexAuthInputRef.current?.click()}
								disabled={authUploadStatus.state === "uploading"}
							>
								UPLOAD AUTH.JSON
							</button>
							<a
								href="https://developers.openai.com/codex/auth/#fallback-authenticate-locally-and-copy-your-auth-cache"
								target="_blank"
								rel="noreferrer"
								className="h-10 px-3 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-yellow-300 hover:bg-white/10 inline-flex items-center"
							>
								OPEN DOCS
							</a>
						</div>
						{authUploadStatus.message && (
							<div
								className={`px-3 py-2 rounded-none border-4 border-white/20 font-mono text-xs font-bold uppercase ${getAuthUploadStatusClass(
									authUploadStatus.state,
								)}`}
							>
								{authUploadStatus.message}
							</div>
						)}
					</div>
				</SettingsField>

				{codexAuthSession?.verificationUrl && !hasValidVerificationUrl && (
					<SettingsField label="Verification URL">
						<div className="h-10 px-3 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs font-bold uppercase text-yellow-200">
							Waiting for a valid device-auth URL.
						</div>
					</SettingsField>
				)}

				<div className="flex gap-2">
					<button
						type="button"
						className="flex-1 h-10 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white hover:bg-white/10"
						onClick={onStartCodexAuth}
					>
						START DEVICE AUTH
					</button>
					<button
						type="button"
						className="h-10 px-4 border-4 border-white/20 bg-transparent font-mono text-xs font-black uppercase text-white/60 hover:bg-white/10 disabled:opacity-30"
						onClick={onCancelCodexAuth}
						disabled={!codexAwaitingBrowser}
					>
						CANCEL
					</button>
				</div>
			</SettingsPanel>
		</div>
	);
}
