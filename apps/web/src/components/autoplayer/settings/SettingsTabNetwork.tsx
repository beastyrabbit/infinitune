import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { SettingsField, SettingsPanel } from "./SettingsPanel";
import { TestButton, type TestStatus } from "./TestButton";

export interface NetworkTabProps {
	ollamaUrl: string;
	setOllamaUrl: (v: string) => void;
	aceStepUrl: string;
	setAceStepUrl: (v: string) => void;
	comfyuiUrl: string;
	setComfyuiUrl: (v: string) => void;
	imageProvider: string;
	ollamaTest: TestStatus;
	aceTest: TestStatus;
	comfyuiTest: TestStatus;
	inferenceShTest: TestStatus;
	codexImagegenTest: TestStatus;
	codexTest: TestStatus;
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
	onTest: (provider: string) => void;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0";
const DEVICE_AUTH_VERIFICATION_URL_REGEX =
	/^https?:\/\/auth\.openai\.com\/codex\/device/i;

export function SettingsTabNetwork({
	ollamaUrl,
	setOllamaUrl,
	aceStepUrl,
	setAceStepUrl,
	comfyuiUrl,
	setComfyuiUrl,
	imageProvider,
	ollamaTest,
	aceTest,
	comfyuiTest,
	inferenceShTest,
	codexImagegenTest,
	codexTest,
	codexAuthSession,
	onUploadCodexAuthFile,
	onStartCodexAuth,
	onCancelCodexAuth,
	onTest,
}: NetworkTabProps) {
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
		state: "idle" | "uploading" | "success" | "error";
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
					trailing={
						<TestButton provider="ace-step" status={aceTest} onTest={onTest} />
					}
				>
					<Input
						className={inputClass}
						placeholder="http://192.168.10.120:8001"
						value={aceStepUrl}
						onChange={(e) => setAceStepUrl(e.target.value)}
					/>
				</SettingsField>

				<SettingsField
					label="ComfyUI URL"
					trailing={
						<TestButton
							provider="comfyui"
							status={comfyuiTest}
							onTest={onTest}
						/>
					}
				>
					<Input
						className={inputClass}
						placeholder="http://192.168.10.120:8188"
						value={comfyuiUrl}
						onChange={(e) => setComfyuiUrl(e.target.value)}
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
								className={`px-3 py-2 rounded-none border-4 border-white/20 font-mono text-xs font-bold uppercase ${
									authUploadStatus.state === "success"
										? "text-green-300 bg-green-950/40"
										: authUploadStatus.state === "error"
											? "text-red-300 bg-red-950/40"
											: "text-yellow-300 bg-yellow-950/40"
								}`}
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
