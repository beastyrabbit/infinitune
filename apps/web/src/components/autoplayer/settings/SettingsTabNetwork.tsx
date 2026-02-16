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
	openrouterApiKey: string;
	setOpenrouterApiKey: (v: string) => void;
	ollamaTest: TestStatus;
	aceTest: TestStatus;
	comfyuiTest: TestStatus;
	openrouterTest: TestStatus;
	codexTest: TestStatus;
	codexAuthSession: {
		id: string;
		state: string;
		verificationUrl?: string;
		userCode?: string;
		message?: string;
		error?: string;
	} | null;
	onStartCodexAuth: () => void;
	onCancelCodexAuth: () => void;
	onTest: (provider: string) => void;
}

const inputClass =
	"h-10 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white focus-visible:ring-0";

export function SettingsTabNetwork({
	ollamaUrl,
	setOllamaUrl,
	aceStepUrl,
	setAceStepUrl,
	comfyuiUrl,
	setComfyuiUrl,
	openrouterApiKey,
	setOpenrouterApiKey,
	ollamaTest,
	aceTest,
	comfyuiTest,
	openrouterTest,
	codexTest,
	codexAuthSession,
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

			<SettingsPanel
				title="AUTHENTICATION"
				badge={
					<TestButton
						provider="openrouter"
						status={openrouterTest}
						onTest={onTest}
					/>
				}
			>
				<SettingsField label="OpenRouter API Key">
					<Input
						type="password"
						className={inputClass}
						placeholder="sk-or-..."
						value={openrouterApiKey}
						onChange={(e) => setOpenrouterApiKey(e.target.value)}
					/>
				</SettingsField>
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

				{codexAuthSession?.verificationUrl && (
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

				{codexAuthSession?.userCode && (
					<SettingsField label="One-Time Code">
						<div className="h-10 px-3 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm font-black leading-[30px] uppercase text-yellow-300 tracking-widest">
							{codexAuthSession.userCode}
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
