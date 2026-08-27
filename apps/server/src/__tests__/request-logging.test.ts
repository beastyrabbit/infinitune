import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const mocks = vi.hoisted(() => {
	const requestError = vi.fn();
	const requestInfo = vi.fn();
	const requestWarn = vi.fn();
	const requestDebug = vi.fn();
	return {
		fetch: null as ((request: Request) => Promise<Response>) | null,
		rootError: vi.fn(),
		child: vi.fn(() => ({
			error: requestError,
			info: requestInfo,
			warn: requestWarn,
			debug: requestDebug,
		})),
		requestError,
		requestInfo,
		requestWarn,
		requestDebug,
	};
});

vi.mock("../logger", () => ({
	logger: {
		child: mocks.child,
		debug: vi.fn(),
		error: mocks.rootError,
		fatal: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
	loggingConfig: {
		level: "silent",
		fileLoggingEnabled: false,
		logFilePath: undefined,
		logSessionId: "test",
	},
}));

vi.mock("@hono/node-server", () => ({
	serve: vi.fn(
		(options: { fetch: (request: Request) => Promise<Response> }) => {
			mocks.fetch = options.fetch;
			return {
				listeners: vi.fn(() => []),
				on: vi.fn(),
				removeAllListeners: vi.fn(),
			};
		},
	),
}));

vi.mock("@hono/node-ws", () => ({
	createNodeWebSocket: vi.fn(() => ({
		injectWebSocket: vi.fn(),
		upgradeWebSocket: vi.fn(() =>
			vi.fn(() => new Response(null, { status: 426 })),
		),
	})),
}));

vi.mock("ws", () => ({
	WebSocketServer: class {
		close = vi.fn();
		emit = vi.fn();
		handleUpgrade = vi.fn();
		on = vi.fn();
	},
}));

vi.mock("../db/index", () => ({ sqlite: { close: vi.fn() } }));
vi.mock("../db/migrate", () => ({ ensureSchema: vi.fn() }));
vi.mock("../events/ws-bridge", () => ({
	addClient: vi.fn(),
	getClientCount: vi.fn(() => 0),
	removeClient: vi.fn(),
	startWsBridge: vi.fn(),
}));
vi.mock("../radio/radio-ws-handler", () => ({
	handleRadioConnection: vi.fn(),
}));
vi.mock("../room/room-event-handler", () => ({
	startRoomEventSync: vi.fn(),
}));
vi.mock("../room/room-manager", () => ({
	RoomManager: class {
		listRooms = vi.fn(() => []);
	},
}));
vi.mock("../room/room-ws-handler", () => ({
	handleRoomConnection: vi.fn(),
}));
vi.mock("../services/playlist-service", () => ({
	deleteExpiredTemporaryPlaylists: vi.fn(async () => 0),
	listActive: vi.fn(async () => []),
}));
vi.mock("../services/radio-station-service", () => ({
	startRadioServiceEventSync: vi.fn(),
}));
vi.mock("../worker/index", () => ({
	getQueues: vi.fn(() => ({ getFullStatus: vi.fn(() => ({})) })),
	getWorkerActorGraph: vi.fn(() => ({})),
	getWorkerInspect: vi.fn(() => ({})),
	getWorkerStats: vi.fn(() => ({ songWorkerCount: 0, trackedPlaylists: [] })),
	startWorker: vi.fn(async () => undefined),
	stopWorkerDiagnostics: vi.fn(),
	triggerPersonaScan: vi.fn(),
}));

vi.mock("../routes/agent-memory", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/autoplayer", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/playlists", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/radio", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/settings", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/songs/index", async () => {
	const { Hono } = await import("hono");
	return { default: new Hono() };
});
vi.mock("../routes/control", async () => {
	const { Hono } = await import("hono");
	return { createControlRoutes: vi.fn(() => new Hono()) };
});
vi.mock("../routes/rooms", async () => {
	const { Hono } = await import("hono");
	return { createRoomRoutes: vi.fn(() => new Hono()) };
});
vi.mock("../routes/share", async () => {
	const { Hono } = await import("hono");
	const app = new Hono();
	app.get("/:token", (c) => {
		if (c.req.param("token") === "throwing-secret") {
			throw new Error("Expected request failure");
		}
		return c.json({ ok: true });
	});
	app.delete("/:id", (c) => c.json({ ok: true }));
	return { default: app };
});

async function request(path: string, init?: RequestInit): Promise<Response> {
	if (!mocks.fetch) throw new Error("Server fetch handler was not captured");
	return mocks.fetch(new Request(`http://localhost${path}`, init));
}

describe("request logging", () => {
	beforeAll(async () => {
		vi.stubEnv("REQUEST_LOG_SUMMARY_INTERVAL_MS", "0");
		vi.stubEnv("TEMP_PLAYLIST_CLEANUP_INTERVAL_MS", "0");
		const processOn = vi.spyOn(process, "on").mockReturnValue(process);
		try {
			await import("../index");
		} finally {
			processOn.mockRestore();
		}
	});

	beforeEach(() => {
		mocks.rootError.mockClear();
		mocks.child.mockClear();
		mocks.requestError.mockClear();
		mocks.requestInfo.mockClear();
		mocks.requestWarn.mockClear();
		mocks.requestDebug.mockClear();
	});

	afterAll(() => {
		vi.unstubAllEnvs();
	});

	it("normalizes share tokens in completed and failed request logs", async () => {
		const completedToken = "completed-bearer-secret";
		expect((await request(`/api/share/${completedToken}`)).status).toBe(200);
		expect(mocks.requestInfo).toHaveBeenCalled();
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(
			completedToken,
		);

		mocks.child.mockClear();
		expect((await request("/api/share/throwing-secret")).status).toBe(500);
		expect(mocks.requestError).toHaveBeenCalled();
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
		);
		expect(mocks.rootError).toHaveBeenCalledWith(
			expect.objectContaining({ method: "GET", path: "/api/share/:token" }),
			"Unhandled request error",
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(
			"throwing-secret",
		);
		expect(JSON.stringify(mocks.rootError.mock.calls)).not.toContain(
			"throwing-secret",
		);
	});

	it("normalizes share-link IDs in deletion logs", async () => {
		const linkId = "private-link-id";
		expect(
			(
				await request(`/api/share/${linkId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(200);
		expect(mocks.child).toHaveBeenLastCalledWith(
			expect.objectContaining({ method: "DELETE", path: "/api/share/:id" }),
		);
		expect(JSON.stringify(mocks.child.mock.calls)).not.toContain(linkId);
	});
});
