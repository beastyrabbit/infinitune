import { ConvexHttpClient } from 'convex/browser'
import * as dotenv from 'node:fs'
import * as path from 'node:path'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  try {
    const content = dotenv.readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
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

let client: ConvexHttpClient | null = null

export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    const url = process.env.VITE_CONVEX_URL
    if (!url) throw new Error('VITE_CONVEX_URL not set — check .env.local')
    client = new ConvexHttpClient(url)
  }
  return client
}
