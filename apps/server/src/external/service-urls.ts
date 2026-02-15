import { logger } from "../logger";
import * as settingsService from "../services/settings-service";

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
		const settings = await settingsService.getAll();
		return {
			ollamaUrl: settings.ollamaUrl || defaults.ollamaUrl,
			aceStepUrl: settings.aceStepUrl || defaults.aceStepUrl,
			comfyuiUrl: settings.comfyuiUrl || defaults.comfyuiUrl,
		};
	} catch (err) {
		logger.warn({ err }, "Failed to load service URLs from DB, using defaults");
		return defaults;
	}
}

export async function getSetting(key: string): Promise<string | null> {
	try {
		return await settingsService.get(key);
	} catch (err) {
		logger.warn({ err, key }, "Failed to load setting from DB");
		return null;
	}
}
