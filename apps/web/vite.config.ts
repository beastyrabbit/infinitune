import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const VITE_API_URL = process.env.VITE_API_URL || env.VITE_API_URL;
	const devServerPort = Number.parseInt(process.env.PORT ?? "", 10);
	const apiBase = VITE_API_URL || "http://localhost:5175";
	let end = apiBase.length;
	while (end > 0 && apiBase[end - 1] === "/") end--;
	const apiProxyTarget = apiBase.slice(0, end);

	return {
		// Vite's import-analysis plugin reads the top-level value when rewriting
		// entry chunks. An environment-only setting produces an empty entry map.
		build: { sourcemap: "hidden" },
		environments: {
			client: { build: { sourcemap: "hidden" } },
			ssr: { build: { sourcemap: false } },
			nitro: { build: { sourcemap: false } },
		},
		server: {
			host: process.env.HOST || undefined,
			port: Number.isFinite(devServerPort) ? devServerPort : undefined,
			strictPort: Number.isFinite(devServerPort),
			proxy: {
				"/covers": {
					target: apiProxyTarget,
					changeOrigin: true,
				},
			},
		},
		resolve: {
			alias: {
				// The pinned nitro-nightly package imports itself as nitro/app.
				"nitro/app": fileURLToPath(
					new URL("./node_modules/nitro/dist/runtime/app.mjs", import.meta.url),
				),
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		plugins: [
			devtools(),
			nitro({ plugins: ["./src/lib/telemetry/nitro.ts"] }),
			// this is the plugin that enables path aliases
			viteTsConfigPaths({
				projects: ["./tsconfig.json"],
			}),
			tailwindcss(),
			tanstackStart(
				mode === "production"
					? { router: { routeFileIgnorePattern: "testlab" } }
					: undefined,
			),
			viteReact(),
		],
	};
});
