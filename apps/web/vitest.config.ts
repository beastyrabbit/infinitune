import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
		exclude: ["src/routes/**"],
		// Node 25+ defines a global localStorage that is undefined without
		// --localstorage-file and hides jsdom's Web Storage.
		poolOptions: {
			forks: { execArgv: ["--no-experimental-webstorage"] },
		},
	},
});
