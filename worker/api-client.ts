import * as fs from "node:fs"
import * as path from "node:path"
import { InfinituneApiClient } from "../api-server/client"

function loadEnv() {
	const envPath = path.join(process.cwd(), ".env.local")
	try {
		const content = fs.readFileSync(envPath, "utf-8")
		for (const line of content.split("\n")) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#")) continue
			const eqIdx = trimmed.indexOf("=")
			if (eqIdx === -1) continue
			const key = trimmed.slice(0, eqIdx).trim()
			const value = trimmed.slice(eqIdx + 1).trim()
			if (!process.env[key]) {
				process.env[key] = value
			}
		}
	} catch {
		// .env.local not found, rely on existing env vars
	}
}

loadEnv()

export const apiClient = new InfinituneApiClient(
	process.env.API_URL ?? "http://localhost:5175",
)
