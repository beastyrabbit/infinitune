import { randomUUID } from "node:crypto";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer } from "ws";
import { sqlite } from "./db/index";
import { ensureSchema } from "./db/migrate";
import {
	addClient,
	getClientCount,
	removeClient,
	startWsBridge,
} from "./events/ws-bridge";
import { logger, loggingConfig } from "./logger";
import { startRoomEventSync } from "./room/room-event-handler";
import { RoomManager } from "./room/room-manager";
import { handleRoomConnection } from "./room/room-ws-handler";
import autoplayerRoutes from "./routes/autoplayer";
import playlistsRoutes from "./routes/playlists";
import { createRoomRoutes } from "./routes/rooms";
import settingsRoutes from "./routes/settings";
import songsRoutes from "./routes/songs/index";
import {
	getQueues,
	getWorkerStats,
	startWorker,
	triggerPersonaScan,
} from "./worker/index";

const PORT = Number(process.env.API_PORT ?? 5175);

// ─── Database ────────────────────────────────────────────────────────
ensureSchema();

// ─── Room manager ────────────────────────────────────────────────────
const roomManager = new RoomManager();

// ─── Hono app ────────────────────────────────────────────────────────
const app = new Hono();

logger.info(
	{
		logLevel: loggingConfig.level,
		fileLoggingEnabled: loggingConfig.fileLoggingEnabled,
		logFilePath: loggingConfig.logFilePath,
		logSessionId: loggingConfig.logSessionId,
	},
	"Logging initialized",
);

// Global error handler
app.onError((err, c) => {
	// Transition validation errors → 422
	if (
		err.message?.startsWith("Invalid song transition:") ||
		err.message?.startsWith("Invalid playlist transition:")
	) {
		return c.json({ error: err.message }, 422);
	}
	logger.error(
		{ err, method: c.req.method, path: c.req.path },
		"Unhandled request error",
	);
	return c.json({ error: "Internal server error", message: err.message }, 500);
});

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// CORS
app.use(
	"*",
	cors({
		origin: (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(","),
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
		allowHeaders: ["Content-Type"],
	}),
);

// Request lifecycle logging with request IDs for easier tracing in dev/log files.
app.use("*", async (c, next) => {
	const requestId = c.req.header("x-request-id") ?? randomUUID();
	c.header("x-request-id", requestId);
	const startedAt = performance.now();
	const requestLogger = logger.child({
		requestId,
		method: c.req.method,
		path: c.req.path,
	});

	try {
		await next();
	} catch (err) {
		requestLogger.error({ err }, "Request handler threw");
		throw err;
	} finally {
		const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
		const status = c.res.status || 200;
		const contentLength = c.res.headers.get("content-length");
		const level =
			status >= 500
				? "error"
				: status >= 400
					? "warn"
					: c.req.path === "/health"
						? "debug"
						: "info";

		requestLogger[level](
			{
				status,
				durationMs,
				contentLength: contentLength ? Number(contentLength) : undefined,
			},
			"HTTP request completed",
		);
	}
});

// ─── Health check ────────────────────────────────────────────────────
app.get("/health", (c) => {
	const queues = getQueues().getFullStatus();
	const worker = getWorkerStats();
	return c.json({
		ok: true,
		wsClients: getClientCount(),
		rooms: roomManager.listRooms().length,
		queues,
		worker,
	});
});

// ─── Worker status (used by frontend queue dashboard) ────────────────
app.get("/api/worker/status", (c) => {
	const queues = getQueues().getFullStatus();
	const worker = getWorkerStats();
	return c.json({
		queues,
		songWorkers: worker.songWorkerCount,
		playlists: worker.trackedPlaylists.map((id) => ({
			id,
			name: id,
			activeSongWorkers: 0,
		})),
		uptime: process.uptime(),
	});
});

// ─── API routes ──────────────────────────────────────────────────────
app.route("/api/settings", settingsRoutes);
app.route("/api/playlists", playlistsRoutes);
app.route("/api/songs", songsRoutes);
app.route("/api/v1", createRoomRoutes(roomManager));

// ─── Autoplayer routes (models, test-connection, legacy audio redirect) ──
app.route("/api/autoplayer", autoplayerRoutes);

// ─── Persona trigger ────────────────────────────────────────────────
app.post("/api/worker/persona/trigger", (c) => {
	try {
		triggerPersonaScan();
		return c.json({ ok: true });
	} catch (err) {
		logger.error({ err }, "Failed to trigger persona scan");
		return c.json({ ok: false, error: "Failed to schedule persona scan" }, 500);
	}
});

// ─── Static file serving for covers ──────────────────────────────────
const DATA_ROOT = path.resolve(import.meta.dirname, "../../../data");
app.use(
	"/covers/*",
	serveStatic({
		root: DATA_ROOT,
		rewriteRequestPath: (p: string) => p,
	}),
);

// ─── Browser WebSocket (event invalidation) ──────────────────────────
app.get(
	"/ws",
	upgradeWebSocket(() => ({
		onOpen(_event, ws) {
			addClient(ws);
			logger.debug({ clients: getClientCount() }, "WS event client connected");
		},
		onClose(_event, ws) {
			removeClient(ws);
			logger.debug(
				{ clients: getClientCount() },
				"WS event client disconnected",
			);
		},
		onMessage(_event, _ws) {
			// Browser clients don't send meaningful messages
		},
	})),
);

// ─── Start HTTP server ───────────────────────────────────────────────
const server = serve(
	{ fetch: app.fetch, port: PORT },
	(info: { port: number }) => {
		logger.info(
			{ port: info.port, rest: `/api/`, ws: `/ws`, room: `/ws/room` },
			`Server listening on http://localhost:${info.port}`,
		);
	},
);

injectWebSocket(server);

// ─── Room WebSocket server ───────────────────────────────────────────
// Room connections use a separate path-based WebSocket server on the same port.
// The `ws` library handles upgrade for `/ws/room` while Hono handles `/ws`.
const roomWss = new WebSocketServer({ noServer: true });

roomWss.on("connection", (ws) => {
	handleRoomConnection(ws, roomManager);
});

// Intercept HTTP upgrade requests: route /ws/room to `ws` library,
// let everything else fall through to Hono's upgradeWebSocket.
const httpServer = server as import("node:http").Server;
const originalListeners = httpServer.listeners("upgrade").slice();

httpServer.removeAllListeners("upgrade");
httpServer.on("upgrade", (request, socket, head) => {
	const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

	if (url.pathname === "/ws/room") {
		roomWss.handleUpgrade(request, socket, head, (ws) => {
			roomWss.emit("connection", ws, request);
		});
	} else {
		// Let Hono's WebSocket handler deal with it
		for (const listener of originalListeners) {
			(listener as (...args: unknown[]) => void)(request, socket, head);
		}
	}
});

// ─── Start event bus → WebSocket bridge ──────────────────────────────
startWsBridge();

// ─── Start room event sync ───────────────────────────────────────────
startRoomEventSync(roomManager);

// ─── Start worker ────────────────────────────────────────────────────
startWorker().catch((err) => {
	logger.error({ err }, "Worker failed to start");
});

// ─── Graceful shutdown ───────────────────────────────────────────────
async function shutdown() {
	logger.info("Shutting down...");
	try {
		roomWss.close();
	} catch (err) {
		logger.error({ err }, "Error closing room WSS");
	}
	try {
		sqlite.close();
	} catch (err) {
		logger.error({ err }, "Error closing SQLite");
	}
	process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
	logger.error({ reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
	logger.fatal({ err }, "Uncaught exception");
});
