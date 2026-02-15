const apiUrl = process.env.VITE_API_URL ?? "http://localhost:5175";

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
		const res = await fetch(`${apiUrl}/api/settings`);
		if (!res.ok) return defaults;
		const settings: Record<string, string> = await res.json();
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
		const res = await fetch(
			`${apiUrl}/api/settings/${encodeURIComponent(key)}`,
		);
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}
