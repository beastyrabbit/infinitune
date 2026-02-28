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
import { createControlRoutes } from "./routes/control";
import playlistsRoutes from "./routes/playlists";
import { createRoomRoutes } from "./routes/rooms";
import settingsRoutes from "./routes/settings";
import songsRoutes from "./routes/songs/index";
import * as playlistService from "./services/playlist-service";
import {
	getQueues,
	getWorkerActorGraph,
	getWorkerInspect,
	getWorkerStats,
	startWorker,
	stopWorkerDiagnostics,
	triggerPersonaScan,
} from "./worker/index";

const parsePort = (value: string | undefined): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 5175;
};

const PORT = parsePort(process.env.PORT ?? process.env.API_PORT);
const REQUEST_LOG_SLOW_MS = Number(process.env.REQUEST_LOG_SLOW_MS ?? 1500);
const REQUEST_LOG_SUMMARY_INTERVAL_MS = Number(
	process.env.REQUEST_LOG_SUMMARY_INTERVAL_MS ?? 30000,
);
const TEMP_PLAYLIST_CLEANUP_INTERVAL_MS = Number(
	process.env.TEMP_PLAYLIST_CLEANUP_INTERVAL_MS ?? 15 * 60 * 1000,
);

type NoisyRequestPattern = {
	method?: string;
	pattern: RegExp;
	route: string;
};

type NoisyRequestAggregate = {
	count: number;
	totalDurationMs: number;
	maxDurationMs: number;
};

const NOISY_REQUEST_PATTERNS: NoisyRequestPattern[] = [
	{
		method: "GET",
		pattern: /^\/api\/worker\/status$/,
		route: "GET /api/worker/status",
	},
	{
		method: "GET",
		pattern: /^\/api\/songs\/queue\/[^/]+$/,
		route: "GET /api/songs/queue/:playlistId",
	},
	{
		method: "GET",
		pattern: /^\/api\/playlists\/by-key\/[^/]+$/,
		route: "GET /api/playlists/by-key/:key",
	},
	{
		method: "GET",
		pattern: /^\/api\/playlists\/[^/]+$/,
		route: "GET /api/playlists/:playlistId",
	},
	{
		method: "POST",
		pattern: /^\/api\/playlists\/[^/]+\/heartbeat$/,
		route: "POST /api/playlists/:playlistId/heartbeat",
	},
	{
		method: "GET",
		pattern: /^\/covers\/.+$/,
		route: "GET /covers/:file",
	},
];

const noisyRequestAggregates = new Map<string, NoisyRequestAggregate>();

function getNoisyRoute(method: string, path: string): string | undefined {
	for (const pattern of NOISY_REQUEST_PATTERNS) {
		if (pattern.method && pattern.method !== method) continue;
		if (pattern.pattern.test(path)) return pattern.route;
	}
	return undefined;
}

function recordNoisyRequest(route: string, durationMs: number): void {
	const current = noisyRequestAggregates.get(route);
	if (!current) {
		noisyRequestAggregates.set(route, {
			count: 1,
			totalDurationMs: durationMs,
			maxDurationMs: durationMs,
		});
		return;
	}
	current.count += 1;
	current.totalDurationMs += durationMs;
	current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
}

function flushNoisyRequestSummary(reason: "interval" | "shutdown"): void {
	if (noisyRequestAggregates.size === 0) return;
	const summary = [...noisyRequestAggregates.entries()]
		.map(([route, agg]) => ({
			route,
			count: agg.count,
			avgDurationMs:
				Math.round((agg.totalDurationMs / Math.max(1, agg.count)) * 10) / 10,
			maxDurationMs: Math.round(agg.maxDurationMs * 10) / 10,
		}))
		.sort((a, b) => b.count - a.count);
	noisyRequestAggregates.clear();
	logger.info(
		{
			reason,
			intervalMs: REQUEST_LOG_SUMMARY_INTERVAL_MS,
			routes: summary,
		},
		"HTTP noisy request summary",
	);
}

const noisyRequestSummaryTimer =
	REQUEST_LOG_SUMMARY_INTERVAL_MS > 0
		? setInterval(
				() => flushNoisyRequestSummary("interval"),
				REQUEST_LOG_SUMMARY_INTERVAL_MS,
			)
		: null;
noisyRequestSummaryTimer?.unref?.();

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
		origin: (
			process.env.ALLOWED_ORIGINS ??
			"http://localhost:5173,http://web.localhost:1355"
		)
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
		allowMethods: ["GET", "POST", "PATCH", "DELETE", "PUT"],
		allowHeaders: ["Content-Type", "Authorization", "x-device-token"],
	}),
);

// Request lifecycle logging with request IDs for easier tracing in dev/log files.
app.use("*", async (c, next) => {
	const requestId = c.req.header("x-request-id") ?? randomUUID();
	c.header("x-request-id", requestId);
	const startedAt = performance.now();
	const method = c.req.method;
	const path = c.req.path;
	const noisyRoute = getNoisyRoute(method, path);
	const requestLogger = logger.child({
		requestId,
		method,
		path,
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
		const isSlow = durationMs >= REQUEST_LOG_SLOW_MS;
		const shouldAggregateNoisy = noisyRoute && status < 400 && !isSlow;

		if (shouldAggregateNoisy) {
			recordNoisyRequest(noisyRoute, durationMs);
		} else {
			const level =
				status >= 500
					? "error"
					: status >= 400
						? "warn"
						: isSlow
							? "warn"
							: c.req.path === "/health"
								? "debug"
								: "info";

			requestLogger[level](
				{
					status,
					durationMs,
					contentLength: contentLength ? Number(contentLength) : undefined,
					route: noisyRoute,
				},
				isSlow ? "HTTP request slow" : "HTTP request completed",
			);
		}
	}
});

// ─── Health check ────────────────────────────────────────────────────
app.get("/health", (c) => {
	const queues = getQueues().getFullStatus();
	const worker = getWorkerStats();
	const actorGraph = getWorkerActorGraph();
	return c.json({
		ok: true,
		wsClients: getClientCount(),
		rooms: roomManager.listRooms().length,
		queues,
		worker,
		actorGraph,
	});
});

// ─── Worker status (used by frontend queue dashboard) ────────────────
app.get("/api/worker/status", async (c) => {
	const queues = getQueues().getFullStatus();
	const worker = getWorkerStats();
	const actorGraph = getWorkerActorGraph();
	const activePlaylists = await playlistService.listActive();
	const playlistNameById = new Map(
		activePlaylists.map((playlist) => [playlist.id, playlist.name]),
	);

	return c.json({
		queues,
		songWorkers: worker.songWorkerCount,
		actorGraph,
		playlists: worker.trackedPlaylists.map((id) => ({
			id,
			name: playlistNameById.get(id) ?? id,
			activeSongWorkers: 0,
		})),
		uptime: process.uptime(),
	});
});

app.get("/api/worker/inspect", async (c) => {
	const limitQuery = c.req.query("limit");
	const limit = limitQuery ? Number.parseInt(limitQuery, 10) : undefined;
	const resolved =
		typeof limit === "number" && Number.isFinite(limit) && limit > 0
			? limit
			: undefined;
	return c.json(getWorkerInspect(resolved));
});

app.get("/api/worker/actors", (c) => {
	const actorGraph = getWorkerActorGraph();
	return c.json({
		actorGraph,
		uptime: process.uptime(),
	});
});

// ─── API routes ──────────────────────────────────────────────────────
app.route("/api/settings", settingsRoutes);
app.route("/api/playlists", playlistsRoutes);
app.route("/api/songs", songsRoutes);
app.route("/api/v1", createControlRoutes(roomManager));
// Legacy compatibility endpoints (`/rooms`, `/now-playing`) while clients migrate.
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
			{ port: info.port, rest: `/api/`, ws: `/ws`, playlist: `/ws/playlist` },
			`Server listening on http://localhost:${info.port}`,
		);
	},
);

injectWebSocket(server);

// ─── Room WebSocket server ───────────────────────────────────────────
// Room connections use a separate path-based WebSocket server on the same port.
// The `ws` library handles upgrade for `/ws/playlist` while Hono handles `/ws`.
const roomWss = new WebSocketServer({ noServer: true });

roomWss.on("connection", (ws) => {
	handleRoomConnection(ws, roomManager);
});

// Intercept HTTP upgrade requests: route /ws/playlist to `ws` library,
// let everything else fall through to Hono's upgradeWebSocket.
const httpServer = server as import("node:http").Server;
const originalListeners = httpServer.listeners("upgrade").slice();

httpServer.removeAllListeners("upgrade");
httpServer.on("upgrade", (request, socket, head) => {
	const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

	if (url.pathname === "/ws/playlist") {
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

// ─── Temporary playlist cleanup ─────────────────────────────────────
const tempPlaylistCleanupTimer =
	TEMP_PLAYLIST_CLEANUP_INTERVAL_MS > 0
		? setInterval(async () => {
				try {
					const removed =
						await playlistService.deleteExpiredTemporaryPlaylists();
					if (removed > 0) {
						logger.info({ removed }, "Deleted expired temporary playlists");
					}
				} catch (err) {
					logger.error({ err }, "Temporary playlist cleanup failed");
				}
			}, TEMP_PLAYLIST_CLEANUP_INTERVAL_MS)
		: null;
tempPlaylistCleanupTimer?.unref?.();

// ─── Graceful shutdown ───────────────────────────────────────────────
async function shutdown() {
	logger.info("Shutting down...");
	if (noisyRequestSummaryTimer) clearInterval(noisyRequestSummaryTimer);
	if (tempPlaylistCleanupTimer) clearInterval(tempPlaylistCleanupTimer);
	flushNoisyRequestSummary("shutdown");
	stopWorkerDiagnostics();
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
