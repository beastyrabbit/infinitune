import { defineConfig } from "@playwright/test";

const common = {
	NODE_ENV: "production",
	TELEMETRY_ENVIRONMENT: "e2e",
	INFINITUNE_RELEASE: "e2e-1.3.0",
};
const analytics = {
	UMAMI_URL: "https://umami.heerlab.com",
	UMAMI_WEBSITE_ID: "16206c2c-c965-46db-8f19-4b60bd97adb6",
	UMAMI_DOMAINS: "127.0.0.1",
	GLITCHTIP_DSN: "https://11111111111111111111111111111111@glitchtip.heerlab.com/7",
	GLITCHTIP_TRACES_SAMPLE_RATE: "0",
};

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	use: { headless: true },
	webServer: [
		{ port: 4471, config: analytics },
		{ port: 4472, config: { UMAMI_URL: "", UMAMI_WEBSITE_ID: "", UMAMI_DOMAINS: "", GLITCHTIP_DSN: "" } },
		{ port: 4473, config: { ...analytics, UMAMI_DOMAINS: "music.example.invalid" } },
	].map(({ port, config }) => ({
		command: "node --import ./e2e/offline.mjs .output/server/index.mjs",
		url: `http://127.0.0.1:${port}`,
		reuseExistingServer: false,
		env: { ...common, ...config, PORT: String(port), HOST: "127.0.0.1", APP_ORIGIN: `http://127.0.0.1:${port}` },
	})),
});
