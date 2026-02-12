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
	onTest,
}: NetworkTabProps) {
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
		</div>
	);
}
