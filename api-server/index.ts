// @ts-expect-error — @hono/node-server has no type declarations
import { serve } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import { Hono } from "hono"
import { cors } from "hono/cors"
// @ts-expect-error — @hono/node-server/serve-static has no type declarations
import { serveStatic } from "@hono/node-server/serve-static"
import { ensureSchema } from "./db/migrate"
import settingsRoutes from "./routes/settings"
import playlistsRoutes from "./routes/playlists"
import songsRoutes from "./routes/songs"
import {
	addClient,
	removeClient,
	startBridge,
	getClientCount,
} from "./ws-bridge"
import { closeRabbit } from "./rabbit"
import { sqlite } from "./db/index"

const PORT = Number(process.env.API_PORT ?? 5175)

// Ensure database schema exists
ensureSchema()

const app = new Hono()

// Global error handler — log and return structured error
app.onError((err, c) => {
	console.error(
		`[api-server] Unhandled error in ${c.req.method} ${c.req.path}:`,
		err,
	)
	return c.json(
		{ error: "Internal server error", message: err.message },
		500,
	)
})

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

// CORS for browser access
app.use(
	"*",
	cors({
		origin: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:5174").split(","),
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
		allowHeaders: ["Content-Type"],
	}),
)

// Health check
app.get("/health", (c) => {
	return c.json({ ok: true, wsClients: getClientCount() })
})

// API routes
app.route("/api/settings", settingsRoutes)
app.route("/api/playlists", playlistsRoutes)
app.route("/api/songs", songsRoutes)

// Static file serving for covers
app.use(
	"/covers/*",
	serveStatic({
		root: "./data",
		rewriteRequestPath: (path: string) => path,
	}),
)

// WebSocket endpoint for browser real-time updates
app.get(
	"/ws",
	upgradeWebSocket(() => ({
		onOpen(_event, ws) {
			addClient(ws)
			console.log(`[ws] Client connected (total: ${getClientCount()})`)
		},
		onClose(_event, ws) {
			removeClient(ws)
			console.log(
				`[ws] Client disconnected (total: ${getClientCount()})`,
			)
		},
		onMessage(_event, _ws) {
			// Browser clients don't send meaningful messages
		},
	})),
)

// Start server
const server = serve(
	{ fetch: app.fetch, port: PORT },
	(info: { port: number }) => {
		console.log(`[api-server] Listening on http://localhost:${info.port}`)
	},
)

injectWebSocket(server)

// Start RabbitMQ → WebSocket bridge
startBridge().catch((err: Error) => {
	console.error(
		"[api-server] Failed to start WS bridge (will retry):",
		err.message,
	)
})

// Graceful shutdown
async function shutdown() {
	console.log("[api-server] Shutting down...")
	await closeRabbit()
	sqlite.close()
	process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
