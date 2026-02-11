import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

let cachedClient: ConvexHttpClient | null = null;

function getClient(): ConvexHttpClient {
	if (!cachedClient) {
		const url = process.env.VITE_CONVEX_URL;
		if (!url) throw new Error("VITE_CONVEX_URL not set");
		cachedClient = new ConvexHttpClient(url);
	}
	return cachedClient;
}

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
		const client = getClient();
		const settings = await client.query(api.settings.getAll);
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
		const client = getClient();
		return await client.query(api.settings.get, { key });
	} catch {
		return null;
	}
}
