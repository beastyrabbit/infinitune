import { InfinituneApiClient } from "../../api-server/client";

const apiUrl = process.env.VITE_API_URL ?? "http://localhost:5175";
const client = new InfinituneApiClient(apiUrl);

export interface ServiceUrls {
	ollamaUrl: string;
	aceStepUrl: string;
	comfyuiUrl: string;
}

const defaults: ServiceUrls = {
	ollamaUrl: process.env.OLLAMA_URL || "http://192.168.10.120:11434",
	aceStepUrl: process.env.ACE_STEP_URL || "http://192.168.10.120:8001",
	comfyuiUrl: process.env.COMFYUI_URL || "http://192.168.10.120:8188",
};

export async function getServiceUrls(): Promise<ServiceUrls> {
	try {
		const settings = await client.getSettings();
		return {
			ollamaUrl: settings.ollamaUrl || defaults.ollamaUrl,
			aceStepUrl: settings.aceStepUrl || defaults.aceStepUrl,
			comfyuiUrl: settings.comfyuiUrl || defaults.comfyuiUrl,
		};
	} catch {
		return defaults;
	}
}

export async function getSetting(key: string): Promise<string | null> {
	try {
		return await client.getSetting(key);
	} catch {
		return null;
	}
}
