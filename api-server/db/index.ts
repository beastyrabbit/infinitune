import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"

const DATA_DIR = path.resolve(import.meta.dirname, "../../data")
const DB_PATH = path.join(DATA_DIR, "infinitune.db")

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true })

const sqlite = new Database(DB_PATH)

// Enable WAL mode for concurrent reads + foreign keys
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")
sqlite.pragma("busy_timeout = 5000")

export const db = drizzle(sqlite, { schema })
export { schema }
export { sqlite }
