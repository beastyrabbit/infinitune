import * as fs from "node:fs";
import * as path from "node:path";
import { InfinituneApiClient } from "../api-server/client";

function loadEnv() {
	const envPath = path.join(process.cwd(), ".env.local");
	try {
		const content = fs.readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			let value = trimmed.slice(eqIdx + 1).trim();
			// Remove surrounding quotes if present
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
	} catch (err: unknown) {
		const code =
			err instanceof Error && "code" in err
				? (err as NodeJS.ErrnoException).code
				: null;
		if (code !== "ENOENT") {
			console.error("[api-client] Error reading .env.local:", err);
		}
	}
}

loadEnv();

export const apiClient = new InfinituneApiClient(
	process.env.API_URL ?? "http://localhost:5175",
);
