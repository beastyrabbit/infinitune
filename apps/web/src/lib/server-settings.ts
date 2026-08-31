import { API_URL as apiUrl } from "@/lib/endpoints";

export interface ServiceUrls {
	ollamaUrl: string;
	aceStepUrl: string;
}

export const DEFAULT_ACE_STEP_URL = "http://192.168.10.242:8001";
const envAceStepUrl = process.env.ACE_STEP_URL?.trim() || "";

const defaults: ServiceUrls = {
	ollamaUrl: process.env.OLLAMA_URL || "http://192.168.10.120:11434",
	aceStepUrl: envAceStepUrl || DEFAULT_ACE_STEP_URL,
};

export async function getServiceUrls(): Promise<ServiceUrls> {
	try {
		const res = await fetch(`${apiUrl}/api/settings`);
		if (!res.ok) return defaults;
		const settings: Record<string, string> = await res.json();
		const persistedAceStepUrl = settings.aceStepUrl?.trim() || "";
		return {
			ollamaUrl: settings.ollamaUrl || defaults.ollamaUrl,
			aceStepUrl: envAceStepUrl || persistedAceStepUrl || DEFAULT_ACE_STEP_URL,
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
